export interface Logger {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

/* eslint-disable no-console -- this is the server's log output (stderr), not debug logging. */
export const consoleLogger: Logger = {
  warn: (message) => {
    console.warn(`[warn] ${message}`);
  },
  error: (message, error) => {
    console.error(`[error] ${message}`, error ?? '');
  },
};
/* eslint-enable no-console */
