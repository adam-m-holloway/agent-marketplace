import { zoneOffsetMs } from './zones';

/**
 * Parse an ISO-8601 timestamp such as "2026-03-29T01:30:00" in the given IANA time zone.
 *
 * Timestamps without an offset used to be read in the server's local time zone, so the
 * same input gave different instants on different servers and was off by an hour around
 * DST changes.
 */
export function parseDate(input: string, timeZone: string): Date {
  if (/([zZ]|[+-]\d\d:\d\d)$/.test(input)) return new Date(input);
  const asUtc = new Date(`${input}Z`);
  return new Date(asUtc.getTime() - zoneOffsetMs(asUtc, timeZone));
}
