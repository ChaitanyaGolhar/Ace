/** Shared loading / error / not-found states, so every screen handles them the same way. */

export function Loading() {
  return (
    <p role="status" data-testid="loading">
      Loading…
    </p>
  );
}

export function ErrorMessage({ message }: { message?: string }) {
  return (
    <p role="alert" data-testid="error">
      {message ?? 'Something went wrong while reading your data. Try reloading the page.'}
    </p>
  );
}

export function NotFound({ message }: { message: string }) {
  return (
    <p role="status" data-testid="not-found">
      {message}
    </p>
  );
}
