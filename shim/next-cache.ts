/**
 * In-memory stand-in for `next/cache` when Lenra handlers run on lenra-api (Hono),
 * not inside a Next.js request.
 */

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  tags: string[];
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function entryKey(keyParts: string[] | undefined): string {
  return (keyParts ?? []).join("\0");
}

export function unstable_cache<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  keyParts?: string[],
  options?: { revalidate?: number | false; tags?: string[] },
): T {
  const revalidateSec =
    options?.revalidate === false ? Number.POSITIVE_INFINITY : (options?.revalidate ?? 300);
  const tags = options?.tags ?? [];
  const key = entryKey(keyParts);

  const wrapped = (async (...args: Parameters<T>) => {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = Promise.resolve(fn(...args))
      .then((value) => {
        store.set(key, {
          value,
          expiresAt:
            revalidateSec === Number.POSITIVE_INFINITY
              ? Number.MAX_SAFE_INTEGER
              : now + revalidateSec * 1000,
          tags,
        });
        inflight.delete(key);
        return value;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });

    inflight.set(key, promise);
    return promise;
  }) as T;

  return wrapped;
}

export function revalidateTag(_tag: string, _options?: { expire?: number }): void {
  for (const [k, entry] of store.entries()) {
    if (entry.tags.includes(_tag)) {
      store.delete(k);
    }
  }
}

export function revalidatePath(_path: string, _type?: "layout" | "page"): void {
  // Next.js path revalidation is a no-op outside the App Router.
}

export function unstable_noStore(): void {
  // Marker for opt-out of caching; no-op on lenra-api.
}
