const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

/** True when a session has been idle too long or is past its absolute lifetime. */
export function isExpired(
  session: { lastSeenAt: Date; createdAt: Date },
  now: number,
): boolean {
  return now > session.lastSeenAt.getTime() + IDLE_MS || now > session.createdAt.getTime() + ABSOLUTE_MS;
}
