// Test helper: a fetch that answers from recorded-response maps (path → {status, body}).
// Unrecorded paths throw, so a test can never reach the network by accident.
import { readFileSync } from 'node:fs';

export const CONSUMERS = [
  { repo: 'adam-m-holloway/team-a', team: 'team-a' },
  { repo: 'adam-m-holloway/team-b', team: 'team-b' },
];

export function loadFixtures(...names) {
  return Object.assign({}, ...names.map((n) => JSON.parse(readFileSync(new URL(`./${n}.json`, import.meta.url), 'utf8'))));
}

export function fixtureFetch(map, calls = []) {
  return async (url) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, '');
    calls.push(path);
    const hit = map[path];
    if (!hit) throw new Error(`unrecorded request: ${path}`);
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
}
