/**
 * JavaScript/TypeScript client for the Bulk URL Checker REST API.
 *
 * Quickstart:
 *
 *     import { Client } from "bulkurlchecker";
 *     const client = new Client({ apiKey: "uck_live_..." });
 *     const out = await client.checkUrls([
 *       "https://example.com",
 *       "https://example.org",
 *     ]);
 *     for (const r of out.results) {
 *       console.log(r.statusCode, r.url, r.isBroken ? "BROKEN" : "ok");
 *     }
 *
 * Designed to be the shortest path from "I need to check 50K URLs" to
 * "results are in my hands" — without writing your own proxy
 * rotation, per-domain rate limiter, soft-404 detector, or retry
 * classifier. Backed by a managed cloud service with residential
 * proxies and per-domain throttling.
 */

import { VERSION } from "./version.js";
import {
  AuthenticationError,
  BulkUrlCheckerError,
  NotFoundError,
  QuotaError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "./exceptions.js";
import {
  CheckResults,
  JobSummary,
  URLResult,
  parseCheckResults,
  parseJobSummary,
  parseURLResult,
} from "./types.js";

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-HTTP-call timeout in ms. Does NOT bound the server-side wait
   *  inside checkUrls() — for that, use the `waitSeconds` option. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface CheckUrlsOptions {
  /** Max seconds to block on the server waiting for completion. 1-900,
   *  default 60. */
  waitSeconds?: number;
  /** Seconds between server-side status polls. 0.5-10, default 2. */
  pollInterval?: number;
  /** Optional Idempotency-Key. Pass a UUIDv4 (or any unique string) to
   *  make retries safe: same key + same body within 24h returns the
   *  original response. Same key + different body returns 409 (raised
   *  as ValidationError). */
  idempotencyKey?: string;
}

export interface SubmitOptions {
  /** Optional Idempotency-Key. Pass a UUIDv4 (or any unique string) to
   *  make retries safe: same key + same body within 24h returns the
   *  original JobSummary. Same key + different body returns 409
   *  (raised as ValidationError). */
  idempotencyKey?: string;
}

export interface GetResultsOptions {
  limit?: number;
  offset?: number;
  /** Opaque pagination cursor from a previous response's `next_cursor`.
   *  When set, `offset` is ignored and results come back in stable
   *  id-asc order. Recommended for full exports. */
  cursor?: string;
}

export interface GetResultsPage {
  results: URLResult[];
  /** Next-page cursor for cursor-based pagination. `null` means no
   *  more pages. Always `null` when the request didn't use a cursor. */
  nextCursor: string | null;
}

export interface IterResultsOptions {
  pageSize?: number;
}

export interface WaitUntilDoneOptions {
  /** Local poll deadline in ms. Throws TimeoutError if exceeded. */
  timeoutMs?: number;
  /** Poll interval in ms. Default 2000. */
  pollIntervalMs?: number;
}

const DEFAULT_BASE_URL = "https://api.bulkurlchecker.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT_PREFIX = "bulkurlchecker-js";

function buildUserAgent(): string {
  const node = typeof process !== "undefined" && process.versions?.node
    ? `node/${process.versions.node}`
    : "node/unknown";
  return `${USER_AGENT_PREFIX}/${VERSION} (${node})`;
}

export class Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new AuthenticationError("apiKey must be a non-empty string");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = buildUserAgent();
    if (!this.fetchImpl) {
      throw new BulkUrlCheckerError(
        "No fetch implementation. Requires Node 18+ or pass options.fetch."
      );
    }
  }

  // ---- Public API ----

  /**
   * Submit URLs and block until results are ready (or timeout).
   * The 5-line case — server polls the job on your behalf for up to
   * `waitSeconds` and returns the full result set in one response.
   *
   * For lists > ~2,000 URLs, the wait will likely time out — use
   * `submit()` + `iterResults()` instead so you're not holding an
   * HTTP connection open for minutes.
   */
  async checkUrls(
    urls: Iterable<string>,
    options: CheckUrlsOptions = {}
  ): Promise<CheckResults> {
    const urlList = this.validateUrls(urls);
    const waitSeconds = options.waitSeconds ?? 60;
    const params = new URLSearchParams();
    params.set("wait_seconds", String(waitSeconds));
    params.set("poll_interval", String(options.pollInterval ?? 2));
    const extraHeaders = options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined;
    // The HTTP timeout must be longer than the server-side wait or
    // the client gives up while the server is still legitimately
    // processing. Extend per-call to waitSeconds + 10s buffer; caller's
    // explicit `Client({ timeoutMs })` wins if higher.
    const timeoutOverrideMs = Math.max(this.timeoutMs, waitSeconds * 1000 + 10_000);
    const body = await this.request<unknown>(
      "POST",
      `/api/v2/jobs/wait?${params.toString()}`,
      { urls: urlList },
      extraHeaders,
      timeoutOverrideMs
    );
    return parseCheckResults(body as Parameters<typeof parseCheckResults>[0]);
  }

  /** Submit a job and return immediately with its id. */
  async submit(
    urls: Iterable<string>,
    options: SubmitOptions = {}
  ): Promise<JobSummary> {
    const urlList = this.validateUrls(urls);
    const extraHeaders = options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined;
    const body = await this.request<unknown>(
      "POST",
      "/api/v2/jobs",
      { urls: urlList },
      extraHeaders
    );
    return parseJobSummary(body as Parameters<typeof parseJobSummary>[0]);
  }

  /** Current state of a previously-submitted job. */
  async getJobStatus(jobId: string): Promise<JobSummary> {
    const body = await this.request<unknown>("GET", `/api/v2/jobs/${encodeURIComponent(jobId)}`);
    return parseJobSummary(body as Parameters<typeof parseJobSummary>[0]);
  }

  /** Fetch one page of results. See iterResults() for streaming.
   *
   *  Pass `cursor` (from a previous response's `nextCursor`) to switch
   *  to stable id-asc pagination. Returns just the results array; use
   *  `getResultsPage()` if you also need the next cursor back. */
  async getResults(
    jobId: string,
    options: GetResultsOptions = {}
  ): Promise<URLResult[]> {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 1000));
    if (options.cursor !== undefined) {
      params.set("cursor", options.cursor);
    } else {
      params.set("offset", String(options.offset ?? 0));
    }
    const body = (await this.request<{ items?: unknown[]; results?: unknown[] }>(
      "GET",
      `/api/v2/jobs/${encodeURIComponent(jobId)}/results?${params.toString()}`
    ));
    const items = (body.items ?? body.results ?? []) as Parameters<typeof parseURLResult>[0][];
    return items.map(parseURLResult);
  }

  /** Cursor-paginated fetch that also returns the next cursor.
   *
   *  Pair with a while-loop:
   *
   *      let cursor: string | undefined = undefined;
   *      while (true) {
   *        const { results, nextCursor } = await client.getResultsPage(jobId, { cursor });
   *        process(results);
   *        if (nextCursor === null) break;
   *        cursor = nextCursor;
   *      }
   *
   *  For most callers `iterResults()` is more ergonomic. */
  async getResultsPage(
    jobId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<GetResultsPage> {
    const params = new URLSearchParams();
    params.set("limit", String(options.limit ?? 1000));
    if (options.cursor !== undefined) {
      params.set("cursor", options.cursor);
    }
    const body = (await this.request<{
      items?: unknown[];
      results?: unknown[];
      next_cursor?: string | null;
    }>(
      "GET",
      `/api/v2/jobs/${encodeURIComponent(jobId)}/results?${params.toString()}`
    ));
    const items = (body.items ?? body.results ?? []) as Parameters<typeof parseURLResult>[0][];
    return {
      results: items.map(parseURLResult),
      nextCursor: body.next_cursor ?? null,
    };
  }

  /** Stream all results for a job in pages.
   *
   *  Uses cursor pagination under the hood for stable iteration even
   *  if results are still landing while you read. Stops when the
   *  server returns `next_cursor: null`. */
  async *iterResults(
    jobId: string,
    options: IterResultsOptions = {}
  ): AsyncGenerator<URLResult[], void, void> {
    const pageSize = options.pageSize ?? 1000;
    // Start with empty-string cursor as the "begin cursor stream"
    // sentinel. Server treats this as "engage cursor mode without an
    // anchor" so the first response carries a real next_cursor when
    // more pages exist. Sending undefined here would land us in offset
    // mode and the iterator would terminate after one page (bug fixed
    // in 0.4.2).
    let cursor: string | undefined = "";
    while (true) {
      const { results, nextCursor } = await this.getResultsPage(jobId, {
        limit: pageSize,
        cursor,
      });
      if (results.length === 0) return;
      yield results;
      if (nextCursor === null) return;
      cursor = nextCursor;
    }
  }

  /**
   * Client-side poll loop. Returns when the job reaches a terminal
   * state (completed/failed/cancelled/paused). Throws TimeoutError
   * if the deadline passes.
   */
  async waitUntilDone(
    jobId: string,
    options: WaitUntilDoneOptions = {}
  ): Promise<JobSummary> {
    const deadline = Date.now() + (options.timeoutMs ?? 900_000);
    const pollMs = options.pollIntervalMs ?? 2000;
    const terminal = new Set(["completed", "failed", "cancelled", "paused"]);
    while (true) {
      const job = await this.getJobStatus(jobId);
      if (terminal.has(job.status)) return job;
      if (Date.now() >= deadline) {
        throw new TimeoutError(
          `Job ${jobId} did not finish within the deadline (last status: ${job.status})`
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  // ---- Internals ----

  private validateUrls(urls: Iterable<string>): string[] {
    const out: string[] = [];
    for (const u of urls) {
      const s = (u ?? "").trim();
      if (!s) continue;
      const lower = s.toLowerCase();
      if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
        throw new ValidationError(
          `URLs must include a scheme (http:// or https://). Got: ${JSON.stringify(u)}`
        );
      }
      out.push(s);
    }
    if (out.length === 0) {
      throw new ValidationError("No valid URLs provided.");
    }
    return out;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    timeoutOverrideMs?: number
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const effectiveTimeoutMs = timeoutOverrideMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": this.userAgent,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(extraHeaders ?? {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const aborted = (err as { name?: string }).name === "AbortError";
      if (aborted) {
        throw new TimeoutError(`HTTP ${method} ${path} timed out after ${effectiveTimeoutMs}ms`);
      }
      throw new BulkUrlCheckerError(
        `Network error calling ${method} ${path}: ${(err as Error).message}`
      );
    } finally {
      clearTimeout(timer);
    }
    return this.handleResponse<T>(response, method, path);
  }

  private async handleResponse<T>(
    response: Response,
    method: string,
    path: string
  ): Promise<T> {
    const requestId = response.headers.get("X-Request-ID") ?? undefined;
    if (response.status >= 200 && response.status < 300) {
      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return {} as T;
      }
    }

    let message = `HTTP ${response.status} on ${method} ${path}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const data = await response.json();
      const err = (data as { error?: unknown }).error;
      if (err && typeof err === "object" && !Array.isArray(err)) {
        const e = err as { code?: string; message?: string; details?: unknown };
        code = e.code ?? code;
        message = e.message ?? message;
        details = e.details;
      } else {
        const detail = (data as { detail?: unknown }).detail;
        if (typeof detail === "string") message = detail;
        else if (detail && typeof detail === "object") {
          const d = detail as { error?: string; message?: string };
          code = d.error ?? code;
          message = d.message ?? message;
          details = Object.fromEntries(
            Object.entries(detail).filter(([k]) => k !== "error" && k !== "message")
          );
        }
      }
    } catch {
      // body wasn't JSON; keep generic message
    }

    const meta = { statusCode: response.status, code, requestId, details };
    if ((response.status === 401 || response.status === 403) && code === "no_credits") {
      throw new QuotaError(message, meta);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(message, meta);
    }
    if (response.status === 404) throw new NotFoundError(message, meta);
    if (response.status === 429) {
      const ra = response.headers.get("Retry-After");
      const retryAfter = ra ? parseInt(ra, 10) : undefined;
      throw new RateLimitError(message, {
        ...meta,
        retryAfter: Number.isFinite(retryAfter as number) ? retryAfter : undefined,
      });
    }
    if (response.status === 402) throw new QuotaError(message, meta);
    if (response.status === 400 || response.status === 422 || response.status === 409) {
      // 409 covers Idempotency-Key reuse with a different body. The
      // README + blog promise ValidationError; the server's
      // error.code ("idempotency_key_mismatch") is preserved on
      // meta.code so callers can branch on the specific cause.
      throw new ValidationError(message, meta);
    }
    if (response.status >= 500) throw new ServerError(message, meta);
    throw new BulkUrlCheckerError(message, meta);
  }
}
