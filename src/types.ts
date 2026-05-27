/**
 * Public response types for the Bulk URL Checker SDK.
 *
 * Plain TS interfaces, no runtime schema validation — keeps the SDK
 * zero-dependency. For full validation, the OpenAPI spec is at
 * https://api.bulkurlchecker.com/openapi.json.
 */

export type JobStatus =
  | "pending"
  | "parsing"
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobSummary {
  jobId: string;
  status: JobStatus;
  totalUrls: number;
  completedUrls: number;
  creditsAllocated: number;
  duplicatesRemoved: number;
  invalidUrlsRejected: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface URLResult {
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  responseTimeMs: number | null;
  redirectChain: string[];
  isBroken: boolean;
  isSoft404: boolean;
  errorCode: string | null;
  contentType: string | null;
}

export interface CheckResults {
  jobId: string;
  status: JobStatus;
  timedOut: boolean;
  totalUrls: number;
  completedUrls: number;
  duplicatesRemoved: number;
  invalidUrlsRejected: number;
  completedAt: string | null;
  results: URLResult[];

  /** True when the engine finished within the wait window. */
  isComplete: boolean;
  /** All results flagged as broken (4xx/5xx/DNS/SSL). */
  broken: URLResult[];
  /** All results flagged as soft-404 (200 OK + "not found" body). */
  soft404s: URLResult[];
}

// ---- Internal parsers (server -> SDK shape) ----

interface RawJob {
  job_id?: string;
  id?: string;
  status?: string;
  total_urls?: number;
  completed_urls?: number;
  credits_allocated?: number;
  duplicates_removed?: number;
  invalid_urls_rejected?: number;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

interface RawURLResult {
  url?: string;
  final_url?: string;
  final?: string;
  status_code?: number;
  status?: number;
  response_time_ms?: number;
  duration_ms?: number;
  redirect_chain?: string[];
  is_broken?: boolean;
  is_soft_404?: boolean;
  error_code?: string;
  error?: string;
  content_type?: string;
}

interface RawCheckResults extends RawJob {
  timed_out?: boolean;
  results?: RawURLResult[];
}

export function parseJobSummary(d: RawJob): JobSummary {
  return {
    jobId: String(d.job_id ?? d.id ?? ""),
    status: (d.status as JobStatus) ?? "pending",
    totalUrls: Number(d.total_urls ?? 0),
    completedUrls: Number(d.completed_urls ?? 0),
    creditsAllocated: Number(d.credits_allocated ?? 0),
    duplicatesRemoved: Number(d.duplicates_removed ?? 0),
    invalidUrlsRejected: Number(d.invalid_urls_rejected ?? 0),
    createdAt: d.created_at ?? null,
    startedAt: d.started_at ?? null,
    completedAt: d.completed_at ?? null,
  };
}

export function parseURLResult(d: RawURLResult): URLResult {
  return {
    url: String(d.url ?? ""),
    finalUrl: d.final_url ?? d.final ?? null,
    statusCode: d.status_code ?? d.status ?? null,
    responseTimeMs: d.response_time_ms ?? d.duration_ms ?? null,
    redirectChain: Array.isArray(d.redirect_chain) ? d.redirect_chain : [],
    isBroken: Boolean(d.is_broken ?? false),
    isSoft404: Boolean(d.is_soft_404 ?? false),
    errorCode: d.error_code ?? d.error ?? null,
    contentType: d.content_type ?? null,
  };
}

export function parseCheckResults(d: RawCheckResults): CheckResults {
  const results = (d.results ?? []).map(parseURLResult);
  const status = (d.status as JobStatus) ?? "pending";
  const timedOut = Boolean(d.timed_out ?? false);
  return {
    jobId: String(d.job_id ?? ""),
    status,
    timedOut,
    totalUrls: Number(d.total_urls ?? 0),
    completedUrls: Number(d.completed_urls ?? 0),
    duplicatesRemoved: Number(d.duplicates_removed ?? 0),
    invalidUrlsRejected: Number(d.invalid_urls_rejected ?? 0),
    completedAt: d.completed_at ?? null,
    results,
    isComplete: status === "completed" && !timedOut,
    broken: results.filter((r) => r.isBroken),
    soft404s: results.filter((r) => r.isSoft404),
  };
}
