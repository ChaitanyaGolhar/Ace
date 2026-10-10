/**
 * In-memory sliding-window rate limiter (§9.1 says in-memory is fine). Counts per key
 * are lost on restart and not shared between server instances.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Would one more hit for `key` at `now` be within the limit? Doesn't record it. */
  allows(key: string, now: number): boolean {
    return this.recent(key, now).length < this.limit;
  }

  record(key: string, now: number): void {
    const recent = this.recent(key, now);
    recent.push(now);
    this.hits.set(key, recent);
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
  }
}
