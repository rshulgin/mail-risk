/**
 * One error shape for the whole API: `{ error: { code, message, details? } }`.
 *
 * Codes are stable strings the UI can branch on; messages are for humans and
 * may change. Throwing `ApiError` anywhere in a route lands here with the right
 * status; anything else becomes a 500 without leaking internals.
 */
export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'unprocessable_content'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  unsupported_media_type: 415,
  payload_too_large: 413,
  unprocessable_content: 422,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static notFound(what: string): ApiError {
    return new ApiError('not_found', `${what} not found`);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError('bad_request', message, details);
  }

  toBody(): { error: { code: ApiErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}
