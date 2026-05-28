/**
 * Unit tests for the Bulk URL Checker JS SDK.
 *
 * Run: pnpm test  (or  npm test  /  vitest run)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  Client,
  NotFoundError,
  QuotaError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../src/index.js";

const API = "https://api.bulkurlchecker.com";

function mockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("No more mock responses queued");
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json", ...(r.headers ?? {}) },
    });
  });
}

function newClient(fetchMock: ReturnType<typeof mockFetch>): Client {
  return new Client({ apiKey: "uck_test_fake", fetch: fetchMock as unknown as typeof fetch });
}

describe("Client construction", () => {
  it("requires an apiKey", () => {
    expect(() => new Client({ apiKey: "" })).toThrow(AuthenticationError);
  });
});

describe("URL validation", () => {
  it("rejects URLs without a scheme", async () => {
    const c = newClient(mockFetch([]));
    await expect(c.checkUrls(["example.com"])).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty input", async () => {
    const c = newClient(mockFetch([]));
    await expect(c.checkUrls([""])).rejects.toBeInstanceOf(ValidationError);
  });

  it("strips whitespace", async () => {
    const mock = mockFetch([{
      status: 200,
      body: {
        job_id: "abc",
        status: "completed",
        timed_out: false,
        total_urls: 1,
        completed_urls: 1,
        results: [{ url: "https://example.com", status_code: 200 }],
      },
    }]);
    const c = newClient(mock);
    const out = await c.checkUrls(["  https://example.com  "]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.url).toBe("https://example.com");
  });
});

describe("checkUrls happy path", () => {
  it("returns parsed CheckResults", async () => {
    const mock = mockFetch([{
      status: 200,
      body: {
        job_id: "abc-123",
        status: "completed",
        timed_out: false,
        total_urls: 2,
        completed_urls: 2,
        duplicates_removed: 0,
        invalid_urls_rejected: 0,
        completed_at: "2026-05-26T00:00:00Z",
        results: [
          { url: "https://example.com", status_code: 200, is_broken: false },
          { url: "https://example.org", status_code: 404, is_broken: true },
        ],
      },
    }]);
    const c = newClient(mock);
    const out = await c.checkUrls(["https://example.com", "https://example.org"]);
    expect(out.isComplete).toBe(true);
    expect(out.totalUrls).toBe(2);
    expect(out.results).toHaveLength(2);
    expect(out.broken).toHaveLength(1);
    expect(out.broken[0]!.url).toBe("https://example.org");
  });
});

describe("submit + iterResults", () => {
  it("submit returns JobSummary", async () => {
    const mock = mockFetch([{
      status: 201,
      body: {
        job_id: "job-xyz",
        status: "parsing",
        total_urls: 5,
        credits_allocated: 5,
      },
    }]);
    const c = newClient(mock);
    const job = await c.submit(Array(5).fill("https://example.com"));
    expect(job.jobId).toBe("job-xyz");
    expect(job.status).toBe("parsing");
    expect(job.totalUrls).toBe(5);
  });

  it("iterResults paginates via cursor and stops on next_cursor=null", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ url: `https://e/${i}`, status_code: 200 }));
    const second = Array.from({ length: 200 }, (_, i) => ({ url: `https://e/${i + 1000}`, status_code: 200 }));
    const mock = mockFetch([
      { status: 200, body: { items: first, next_cursor: "cursor-abc" } },
      { status: 200, body: { items: second, next_cursor: null } },
    ]);
    const c = newClient(mock);
    const batches: number[] = [];
    for await (const batch of c.iterResults("job-xyz", { pageSize: 1000 })) {
      batches.push(batch.length);
    }
    expect(batches).toEqual([1000, 200]);
  });
});

describe("error mapping", () => {
  it("401 -> AuthenticationError", async () => {
    const mock = mockFetch([{ status: 401, body: { error: { code: "unauthorized", message: "bad key" } } }]);
    const c = newClient(mock);
    await expect(c.checkUrls(["https://example.com"])).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("429 -> RateLimitError with retryAfter", async () => {
    const mock = mockFetch([{
      status: 429,
      body: { error: { code: "rate_limited", message: "slow down" } },
      headers: { "Retry-After": "60" },
    }]);
    const c = newClient(mock);
    await expect(c.checkUrls(["https://example.com"]))
      .rejects.toSatisfy((e: unknown) => e instanceof RateLimitError && e.retryAfter === 60);
  });

  it("402 -> QuotaError", async () => {
    const mock = mockFetch([{ status: 402, body: { error: { code: "no_credits", message: "out" } } }]);
    const c = newClient(mock);
    await expect(c.checkUrls(["https://example.com"])).rejects.toBeInstanceOf(QuotaError);
  });

  it("404 on getJobStatus -> NotFoundError", async () => {
    const mock = mockFetch([{ status: 404, body: { error: { code: "not_found", message: "no" } } }]);
    const c = newClient(mock);
    await expect(c.getJobStatus("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("500 -> ServerError", async () => {
    const mock = mockFetch([{ status: 500, body: { error: { code: "internal_error", message: "boom" } } }]);
    const c = newClient(mock);
    await expect(c.checkUrls(["https://example.com"])).rejects.toBeInstanceOf(ServerError);
  });

  it("propagates X-Request-ID onto the error", async () => {
    const mock = mockFetch([{
      status: 500,
      body: { error: { code: "internal_error", message: "boom" } },
      headers: { "X-Request-ID": "req-abc" },
    }]);
    const c = newClient(mock);
    await expect(c.checkUrls(["https://example.com"]))
      .rejects.toSatisfy((e: unknown) => e instanceof ServerError && e.requestId === "req-abc");
  });
});

describe("User-Agent", () => {
  it("identifies as the SDK so server channel telemetry can count it", async () => {
    let capturedUA: string | null = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers as HeadersInit);
      capturedUA = headers.get("User-Agent");
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const c = new Client({ apiKey: "uck_test", fetch: fetchMock as unknown as typeof fetch });
    await c.getResults("job");
    expect(capturedUA).toMatch(/^bulkurlchecker-js\//);
  });
});
