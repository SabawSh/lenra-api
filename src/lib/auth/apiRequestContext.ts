import { AsyncLocalStorage } from "node:async_hooks";

type Store = { request: Request };

const storage = new AsyncLocalStorage<Store>();

/** Run Lenra route handler logic with the incoming HTTP request (lenra-api). */
export function runWithApiRequest<T>(
  request: Request,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(storage.run({ request }, fn));
}

export function getApiRequest(): Request | null {
  return storage.getStore()?.request ?? null;
}
