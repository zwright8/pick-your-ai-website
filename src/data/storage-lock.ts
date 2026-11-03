/** Coordinate cooperating tabs when the browser provides the Web Locks API. */
export async function withBuildStorageLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return operation();
  // Normalize synchronous throws to a rejected promise so implementations release the lock.
  return locks.request('pickyour-ai.local-builds.v1', { mode: 'exclusive' }, async () =>
    operation(),
  );
}
