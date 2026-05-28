# Changelog

All notable changes to this project will be documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/) once
it reaches 1.0. While we're at 0.x, breaking changes may land in minor
releases; they'll always be noted under "Changed" or "Removed."

## [Unreleased]

## [0.2.0] - 2026-05-28

### Added
- `idempotencyKey` option on `client.submit()` and `client.checkUrls()`.
  Pass a UUIDv4 (or any unique string) to make retries safe. Same key +
  same body within 24h returns the original response without creating a
  duplicate job. Same key + different body throws `ValidationError`. Sent
  as the `Idempotency-Key` HTTP header per the IETF draft / Stripe
  convention.

## [0.1.0] - 2026-05-XX

Initial release.

### Added
- `Client({ apiKey, baseUrl?, timeoutMs?, fetch? })` for the Bulk URL Checker REST API.
- `client.checkUrls(urls, { waitSeconds?, pollInterval? })` — submit + block + results in one call.
- `client.submit(urls)` — async submission returning a `JobSummary`.
- `client.getJobStatus(jobId)`, `getResults(jobId, { limit?, offset? })`, `iterResults(jobId, { pageSize? })`, `waitUntilDone(jobId, { timeoutMs?, pollIntervalMs? })`.
- Exception hierarchy under `BulkUrlCheckerError`: `AuthenticationError`, `RateLimitError` (with `retryAfter`), `QuotaError`, `ValidationError`, `NotFoundError`, `ServerError`, `TimeoutError`.
- Types: `CheckResults`, `JobSummary`, `URLResult`, `JobStatus`.
- Full TypeScript types, dual ESM + CJS builds, Node 18+ (global `fetch`).
- User-Agent set to `bulkurlchecker-js/<version> (node/<version>)` so server-side channel telemetry can distinguish SDK traffic.
- Zero runtime dependencies.
