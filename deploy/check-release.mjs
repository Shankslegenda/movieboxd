// A low-memory preflight: never loads the production TMDB key or SQLite database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../server/app.ts';
const version = JSON.parse(await readFile(new URL('../dist/version.json', import.meta.url)));
assert.match(version.revision, /^[a-f0-9]{40}$/);
const app = buildApp({ database: ':memory:' });
try {
  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
  const home = await app.inject('/');
  assert.equal(home.statusCode, 200);
  const asset = home.body.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await app.inject(asset)).statusCode, 200);
  assert.equal((await app.inject('/version.json')).json().revision, version.revision);
  console.log(`RELEASE_CHECK_PASSED ${version.revision}`);
} finally {
  await app.close();
}
