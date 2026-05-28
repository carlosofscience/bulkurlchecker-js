/**
 * Webhook signature verification for incoming POSTs from Bulk URL Checker.
 *
 * When a job finishes, our server POSTs to your registered endpoint
 * with a header like:
 *
 *     Bulkurlchecker-Signature: t=1779938676,v1=498569f1729...
 *
 * Use `verifySignature()` to reject anyone who isn't us. Skipping this
 * check means anyone who knows your endpoint URL can fake completion
 * events. Don't skip it.
 *
 * Minimal example with Express:
 *
 *     import express from "express";
 *     import { verifySignature, InvalidSignatureError } from "bulkurlchecker";
 *
 *     const app = express();
 *     // body-parser must be wired with `raw` so the raw bytes survive
 *     // for signature verification.
 *     app.post(
 *       "/webhook/bulkurlchecker",
 *       express.raw({ type: "application/json" }),
 *       (req, res) => {
 *         try {
 *           verifySignature(
 *             req.body, // a Buffer
 *             req.header("Bulkurlchecker-Signature") ?? "",
 *             process.env.MY_WEBHOOK_SECRET!,
 *           );
 *         } catch (err) {
 *           if (err instanceof InvalidSignatureError) {
 *             return res.status(401).end();
 *           }
 *           throw err;
 *         }
 *         const event = JSON.parse(req.body.toString("utf-8"));
 *         // ... handle event ...
 *         res.status(200).end();
 *       }
 *     );
 *
 * Tolerance defaults to 300 seconds. Beyond that the signature is
 * rejected even if cryptographically valid, to defeat replay attacks
 * with the same captured payload.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

import { BulkUrlCheckerError } from "./exceptions.js";

export const DEFAULT_TOLERANCE_SECONDS = 300;

export class InvalidSignatureError extends BulkUrlCheckerError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

export interface VerifySignatureOptions {
  /** Reject signatures older than this many seconds (replay protection).
   *  Defaults to 300 (5 min). Set to 0 to disable -- don't, in production. */
  toleranceSeconds?: number;
  /** Override `Date.now`-style clock for tests. Don't touch in prod. */
  nowMs?: () => number;
}

interface ParsedSignature {
  ts: number;
  v1: string;
}

function parseSignatureHeader(header: string): ParsedSignature {
  if (!header) {
    throw new InvalidSignatureError("Missing Bulkurlchecker-Signature header");
  }
  const parts: Record<string, string> = {};
  for (const seg of header.split(",")) {
    const eq = seg.indexOf("=");
    if (eq < 1) {
      throw new InvalidSignatureError(`Malformed signature header: ${seg}`);
    }
    parts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }
  const tsRaw = parts.t;
  const v1 = parts.v1;
  if (tsRaw === undefined || v1 === undefined) {
    throw new InvalidSignatureError(
      "Signature header missing required 't' and/or 'v1' fields"
    );
  }
  const ts = Number(tsRaw);
  if (!Number.isInteger(ts)) {
    throw new InvalidSignatureError(`Non-integer timestamp: ${tsRaw}`);
  }
  return { ts, v1 };
}

/**
 * Verify the Bulkurlchecker-Signature header.
 *
 * @param rawBody The HTTP request body as a Buffer or Uint8Array.
 *   Pass the RAW bytes -- re-encoding parsed JSON changes whitespace
 *   and breaks the signature.
 * @param header The full value of the Bulkurlchecker-Signature header.
 * @param secret Your endpoint's signing_secret.
 * @throws InvalidSignatureError on missing / malformed / expired / mismatched.
 */
export function verifySignature(
  rawBody: Buffer | Uint8Array | string,
  header: string,
  secret: string,
  options: VerifySignatureOptions = {}
): void {
  if (!secret) {
    throw new InvalidSignatureError("secret must be non-empty");
  }

  // Normalize body to a Buffer. Strings are accepted for convenience
  // but the raw bytes must already be UTF-8 of the original POST.
  let bodyBuf: Buffer;
  if (typeof rawBody === "string") {
    bodyBuf = Buffer.from(rawBody, "utf-8");
  } else if (rawBody instanceof Uint8Array) {
    bodyBuf = Buffer.from(rawBody);
  } else {
    throw new InvalidSignatureError(
      "rawBody must be a Buffer, Uint8Array, or string"
    );
  }

  const { ts, v1 } = parseSignatureHeader(header);

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const nowMs = options.nowMs?.() ?? Date.now();
    const now = Math.floor(nowMs / 1000);
    if (Math.abs(now - ts) > tolerance) {
      throw new InvalidSignatureError(
        `Signature timestamp outside tolerance window of ${tolerance}s ` +
          `(received ${ts}, now ${now}). Replay attempt or clock skew.`
      );
    }
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${ts}.`, "utf-8"),
    bodyBuf,
  ]);
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // timingSafeEqual requires equal-length buffers. We pre-check.
  const expectedBuf = Buffer.from(expected, "utf-8");
  const v1Buf = Buffer.from(v1, "utf-8");
  if (expectedBuf.length !== v1Buf.length || !timingSafeEqual(expectedBuf, v1Buf)) {
    throw new InvalidSignatureError(
      "Signature does not match. Body may have been tampered with, " +
        "or the wrong secret was supplied."
    );
  }
}
