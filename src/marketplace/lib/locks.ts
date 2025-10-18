// src/marketplace/lib/locks.ts
const pidLocks = new Map<string, Promise<void>>();
export async function runWithLock<T>(pid: string, fn: () => Promise<T>): Promise<T> {
  const prev = pidLocks.get(pid) ?? Promise.resolve();
  let resolveHolder: () => void;
  const next = new Promise<void>((res) => { resolveHolder = res; });
  pidLocks.set(pid, prev.then(() => next));
  try {
    await prev;
    const result = await fn();
    return result;
  } finally {
    pidLocks.delete(pid);
    // @ts-ignore
    resolveHolder();
  }
}

export default {};
