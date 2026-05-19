// SPDX-License-Identifier: AGPL-3.0-only

export interface RateLimitPolicy {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
}

interface Bucket {
  count: number;
  resetAtMs: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  consume(key: string, policy: RateLimitPolicy): RateLimitResult {
    const nowMs = this.now();
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAtMs > nowMs
        ? current
        : {
            count: 0,
            resetAtMs: nowMs + policy.windowMs,
          };

    if (bucket.count >= policy.max) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        limit: policy.max,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
        resetAt: new Date(bucket.resetAtMs).toISOString(),
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: true,
      limit: policy.max,
      remaining: Math.max(0, policy.max - bucket.count),
      retryAfterSeconds: 0,
      resetAt: new Date(bucket.resetAtMs).toISOString(),
    };
  }
}
