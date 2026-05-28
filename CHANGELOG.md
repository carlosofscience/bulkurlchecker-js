# Changelog

All notable changes to this project will be documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/) once
it reaches 1.0. While we're at 0.x, breaking changes may land in minor
releases; they'll always be noted under "Changed" or "Removed."

## [Unreleased]

## [0.4.1] - 2026-05-28

### Fixed
- CI publish workflow now upgrades npm to the latest version before
  publishing. Node 20 LTS ships with npm 10.x, which doesn't fully
  support npm Trusted Publishers (OIDC). 11.5.1+ is required. Without
  this, `npm publish` falls back to token auth and returns
  `404 Not Found` on the PUT step because there's no token in the env.

No code changes vs 0.4.0; this is a re-publish of identical source
that the broken workflow couldn't push.

## [0.4.0] - 2026-05-28

### Added
- `verifySignature(rawBody, header, secret)` for verifying incoming
  `Bulkurlchecker-Signature` headers on webhook receivers. Raises
  `InvalidSignatureError` on missing / malformed / expired / tampered
  signatures.
- `InvalidSignatureError` class (subclass of `BulkUrlCheckerError`).
- 5-minute default replay-attack tolerance window. Override via
  `toleranceSeconds`.

## [0.3.0] - 2026-05-28

### Added
- `cursor` option on `client.getResults()` for stable id-asc pagination.
- New `client.getResultsPage()` returns `{ results, nextCursor }` for
  callers that want explicit cursor control.
- `client.iterResults()` now uses cursor pagination under the hood for
  stable iteration even if results are still landing while you read.
  Public API unchanged.

### Changed
- `iterResults()` request sequence: pages 2+ now send `cursor=` instead
  of `offset=`. Behavior is identical for normal callers; only matters
  if you mock the transport in tests.

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
