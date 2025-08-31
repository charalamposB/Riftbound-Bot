import { expireOlderThan } from '../lib/pendingStore'
export function startPendingCleanup() {
  const HOUR = 60 * 60 * 1000
  const TTL  = 7 * 24 * HOUR
  setInterval(() => { expireOlderThan(TTL).catch(() => {}) }, HOUR)
}
