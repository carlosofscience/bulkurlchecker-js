/**
 * Exception hierarchy for the Bulk URL Checker SDK.
 *
 * All errors derive from BulkUrlCheckerError so callers can catch a
 * single type and branch on it. Specific subclasses exist for the
 * error categories devs actually want to handle differently.
 */

export interface ErrorMeta {
  statusCode?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
}

export class BulkUrlCheckerError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(message: string, meta: ErrorMeta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = meta.statusCode;
    this.code = meta.code;
    this.requestId = meta.requestId;
    this.details = meta.details;
  }
}

/** 401 / 403 — the API key is missing, invalid, or revoked. */
export class AuthenticationError extends BulkUrlCheckerError {}

/** 429 — slow down. Check `retryAfter` (seconds) when present. */
export class RateLimitError extends BulkUrlCheckerError {
  public readonly retryAfter?: number;
  constructor(message: string, meta: ErrorMeta & { retryAfter?: number } = {}) {
    super(message, meta);
    this.retryAfter = meta.retryAfter;
  }
}

/** 402 / 403 — out of credits or hit a plan limit. */
export class QuotaError extends BulkUrlCheckerError {}

/** 400 / 422 — malformed request (bad URLs, too many URLs). */
export class ValidationError extends BulkUrlCheckerError {}

/** 404 — job_id not found, not owned by this key, or doesn't exist. */
export class NotFoundError extends BulkUrlCheckerError {}

/** 5xx — transient on our side; safe to retry with backoff. */
export class ServerError extends BulkUrlCheckerError {}

/** Local timeout (e.g. AbortController fired). */
export class TimeoutError extends BulkUrlCheckerError {}
