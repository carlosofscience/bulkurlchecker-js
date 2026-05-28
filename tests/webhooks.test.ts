import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { describe, it, expect } from "vitest";

import {
  verifySignature,
  InvalidSignatureError,
  DEFAULT_TOLERANCE_SECONDS,
} from "../src/webhooks.js";

const SECRET = "test-secret-do-not-use-in-prod-" + "a".repeat(32);

function makeHeader(secret: string, body: Buffer | string, ts: number): string {
  const bodyBuf = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  const signed = Buffer.concat([Buffer.from(`${ts}.`, "utf-8"), bodyBuf]);
  const sig = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("verifySignature", () => {
  it("accepts a valid signature", () => {
    const body = JSON.stringify({ hello: "world" });
    const ts = Math.floor(Date.now() / 1000);
    const header = makeHeader(SECRET, body, ts);
    expect(() => verifySignature(body, header, SECRET)).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const body = '{"hello":"world"}';
    const ts = Math.floor(Date.now() / 1000);
    const header = makeHeader(SECRET, body, ts);
    expect(() => verifySignature('{"hello":"world!"}', header, SECRET)).toThrow(
      InvalidSignatureError
    );
  });

  it("rejects a wrong secret", () => {
    const body = '{"hello":"world"}';
    const ts = Math.floor(Date.now() / 1000);
    const header = makeHeader(SECRET, body, ts);
    expect(() => verifySignature(body, header, "wrong-secret-" + "x".repeat(40))).toThrow(
      InvalidSignatureError
    );
  });

  it("rejects a missing header", () => {
    expect(() => verifySignature("{}", "", SECRET)).toThrow(InvalidSignatureError);
  });

  it("rejects a malformed header", () => {
    expect(() => verifySignature("{}", "garbage", SECRET)).toThrow(InvalidSignatureError);
    expect(() => verifySignature("{}", "t=1", SECRET)).toThrow(InvalidSignatureError);
    expect(() => verifySignature("{}", "t=abc,v1=def", SECRET)).toThrow(InvalidSignatureError);
  });

  it("rejects an old signature outside tolerance", () => {
    const body = "{}";
    const oldTs = Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 60;
    const header = makeHeader(SECRET, body, oldTs);
    expect(() => verifySignature(body, header, SECRET)).toThrow(/outside tolerance/);
  });

  it("accepts an old signature when tolerance=0", () => {
    const body = "{}";
    const oldTs = 1;
    const header = makeHeader(SECRET, body, oldTs);
    expect(() =>
      verifySignature(body, header, SECRET, { toleranceSeconds: 0 })
    ).not.toThrow();
  });

  it("rejects an empty secret", () => {
    expect(() => verifySignature("{}", "t=1,v1=x", "")).toThrow(/non-empty/);
  });

  it("handles Buffer body", () => {
    const body = Buffer.from('{"a":1}', "utf-8");
    const ts = Math.floor(Date.now() / 1000);
    const header = makeHeader(SECRET, body, ts);
    expect(() => verifySignature(body, header, SECRET)).not.toThrow();
  });

  it("handles Uint8Array body", () => {
    const body = new TextEncoder().encode('{"a":1}');
    const ts = Math.floor(Date.now() / 1000);
    const header = makeHeader(SECRET, Buffer.from(body), ts);
    expect(() => verifySignature(body, header, SECRET)).not.toThrow();
  });
});
