# bulkurlchecker

[![npm version](https://img.shields.io/npm/v/bulkurlchecker.svg)](https://www.npmjs.com/package/bulkurlchecker)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

JavaScript/TypeScript client for the [Bulk URL Checker](https://bulkurlchecker.com) API.

**Skip the proxy-rotation, rate-limiter, soft-404 detector, and retry classifier you would otherwise spend two weeks building.** Submit thousands of URLs, get status codes, redirect chains, and broken-link detection back as plain TypeScript objects. Backed by a managed cloud service with residential proxies and per-domain throttling.

## Install

```bash
npm install bulkurlchecker
# or
pnpm add bulkurlchecker
# or
yarn add bulkurlchecker
```

Requires Node 18+ (uses global `fetch`).

## 5-line example

```ts
import { Client } from "bulkurlchecker";

const client = new Client({ apiKey: "uck_live_..." });
const out = await client.checkUrls(["https://example.com", "https://example.org"]);
for (const r of out.results) {
  console.log(r.statusCode, r.url, r.isBroken ? "BROKEN" : "ok");
}
```

Get an API key at https://app.bulkurlchecker.com/dashboard/api-keys. First 300 URLs are free, no card required.

## What you get back

```ts
const out = await client.checkUrls(urls);

out.status;             // 'completed' | 'paused' | 'failed' | 'cancelled'
out.timedOut;           // true if the wait deadline passed (job still running)
out.totalUrls;          // how many URLs the engine accepted
out.completedUrls;      // how many it finished checking
out.duplicatesRemoved;
out.invalidUrlsRejected;

for (const r of out.results) {
  r.url;                // the original URL you submitted
  r.finalUrl;           // after redirects
  r.statusCode;         // 200, 301, 404, 429, 500, ...
  r.redirectChain;      // array of intermediate URLs
  r.isBroken;           // true if the engine flagged this as broken
  r.isSoft404;          // true if 200 OK but page content says "not found"
  r.responseTimeMs;
}

out.broken;             // URLResult[] where isBroken === true
out.soft404s;           // URLResult[] where isSoft404 === true
out.isComplete;         // status === 'completed' && !timedOut
```

## Larger jobs: submit + stream

`checkUrls()` blocks for up to 15 minutes server-side. For lists where the wait would time out, use the two-step pattern:

```ts
const job = await client.submit(my500kUrls);
console.log(`Submitted ${job.jobId}, ${job.totalUrls} URLs queued`);

const done = await client.waitUntilDone(job.jobId, { timeoutMs: 3_600_000 });

for await (const batch of client.iterResults(job.jobId, { pageSize: 1000 })) {
  for (const r of batch) {
    if (r.isBroken) console.log(r.url, r.statusCode);
  }
}
```

## Safe retries with `idempotencyKey`

Pass an idempotency key on `submit()` or `checkUrls()` to make retries safe under network failures. The server caches the response for 24 hours; a retry with the same key + same body returns the original result without creating a duplicate job.

```ts
import { randomUUID } from "node:crypto";

const key = randomUUID(); // generate once per logical request

// First call: creates a new job.
const job = await client.submit(urls, { idempotencyKey: key });

// Network blip, no clean response received? Just retry with the same
// key — you'll get the SAME job summary back, no duplicate submission.
const sameJob = await client.submit(urls, { idempotencyKey: key });
// job.jobId === sameJob.jobId
```

Same `idempotencyKey` + different `urls` returns `409 Conflict` (raised as `ValidationError`) so client bugs that reuse a key against a new payload are caught loudly instead of silently mapping to the wrong cached response.

## Error handling

All errors derive from `BulkUrlCheckerError`. Catch specific subclasses when you want to branch on the failure mode:

```ts
import {
  Client,
  BulkUrlCheckerError,
  AuthenticationError,
  RateLimitError,
  QuotaError,
  ValidationError,
} from "bulkurlchecker";

try {
  const out = await client.checkUrls(urls);
} catch (err) {
  if (err instanceof QuotaError) {
    console.error("Out of credits. Top up at https://app.bulkurlchecker.com/billing");
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited. Retry after ${err.retryAfter}s.`);
  } else if (err instanceof AuthenticationError) {
    console.error("API key rejected — check it's not revoked.");
  } else if (err instanceof ValidationError) {
    console.error("Bad request:", err.message);
  } else if (err instanceof BulkUrlCheckerError) {
    console.error(`Other error: ${err.message} (request_id=${err.requestId})`);
  } else {
    throw err;
  }
}
```

Every error carries `statusCode`, `code` (server's machine-readable string), `requestId` (for support), and `details` (when the server provides them).

## Pricing

- **Free tier:** 300 URL checks. No signup required.
- **Starter:** $9/month or $90/year (~17% off) — 15,000 URLs/month
- **Pro:** $29/month or $290/year — 50,000 URLs/month, 5 scheduled checks
- **Agency:** $99/month or $990/year — 200,000 URLs/month, 50 schedules

Top-up credit packs available beyond the monthly pool. Credits never expire.

## Links

- [Web app](https://app.bulkurlchecker.com)
- [REST API reference](https://bulkurlchecker.com/developers)
- [OpenAPI spec](https://api.bulkurlchecker.com/openapi.json)
- [GitHub](https://github.com/carlosofscience/bulkurlchecker-js)
- [Changelog](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
