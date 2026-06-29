// Tiny pub/sub so non-React code (e.g. the axios interceptor) can trigger the
// upgrade modal, and the <UpgradeNag> component can subscribe to it.

type Listener = (reason?: string) => void;

const listeners = new Set<Listener>();

export function onUpgradePrompt(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Open the upgrade modal, optionally with a reason (e.g. a limit message). */
export function notifyUpgrade(reason?: string): void {
  listeners.forEach((l) => l(reason));
}
