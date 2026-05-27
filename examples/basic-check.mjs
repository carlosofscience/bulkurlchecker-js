/**
 * Minimal example: check a few URLs and print broken ones.
 *
 * Run with:
 *   export BULKURLCHECKER_API_KEY=uck_live_...
 *   node examples/basic-check.mjs
 */

import { Client } from "bulkurlchecker";

const apiKey = process.env.BULKURLCHECKER_API_KEY;
if (!apiKey) {
  console.error(
    "Set BULKURLCHECKER_API_KEY first. Get a key at " +
      "https://app.bulkurlchecker.com/dashboard/api-keys"
  );
  process.exit(1);
}

const client = new Client({ apiKey });

const urls = [
  "https://example.com",
  "https://example.org",
  "https://example.com/nonexistent-page-for-demo",
];

console.log(`Submitting ${urls.length} URLs...`);
const out = await client.checkUrls(urls, { waitSeconds: 60 });

console.log(
  `\nFinished: status=${out.status}, ` +
    `completed=${out.completedUrls}/${out.totalUrls}`
);
console.log(`Broken: ${out.broken.length}\n`);

for (const r of out.results) {
  const marker = r.isBroken ? "BROKEN" : "  ok  ";
  console.log(`  [${marker}] ${String(r.statusCode ?? "?").padStart(3)} ${r.url}`);
}

if (out.broken.length > 0) {
  console.log(`\n${out.broken.length} URL(s) need attention.`);
}
