/**
 * bulkurlchecker — JavaScript/TypeScript client for the Bulk URL Checker API.
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
 * Get an API key at https://app.bulkurlchecker.com/dashboard/api-keys.
 */

export { Client } from "./client.js";
export type {
  ClientOptions,
  CheckUrlsOptions,
  GetResultsOptions,
  IterResultsOptions,
  WaitUntilDoneOptions,
} from "./client.js";
export {
  BulkUrlCheckerError,
  AuthenticationError,
  RateLimitError,
  QuotaError,
  ValidationError,
  NotFoundError,
  ServerError,
  TimeoutError,
} from "./exceptions.js";
export type { ErrorMeta } from "./exceptions.js";
export type {
  CheckResults,
  JobStatus,
  JobSummary,
  URLResult,
} from "./types.js";
export { VERSION } from "./version.js";
