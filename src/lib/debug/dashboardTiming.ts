/** No-op timing wrappers — instrumentation removed after profiling. */
export async function dashTime<T>(
  _name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}

export function dashTimeSync<T>(_name: string, fn: () => T): T {
  return fn();
}
