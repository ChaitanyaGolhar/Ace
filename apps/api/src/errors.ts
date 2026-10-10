import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger';

/** An error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'not_found', 'Not found'));
};

/** Every error leaves the API in one shape: `{ error: { code, message } }` (§9.3). */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    let status = 500;
    let code = 'internal';
    let message = 'Something went wrong';
    if (err instanceof HttpError) {
      ({ status, code, message } = err);
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'invalid_request';
      message = err.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .slice(0, 5)
        .join('; ');
    } else if (isBodyParserError(err)) {
      status = err.status;
      code = err.status === 413 ? 'payload_too_large' : 'invalid_request';
      message = err.status === 413 ? 'Request body too large' : 'Malformed request body';
    } else {
      logger.error('Unhandled error', err);
    }
    res.status(status).json({ error: { code, message } });
  };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}
