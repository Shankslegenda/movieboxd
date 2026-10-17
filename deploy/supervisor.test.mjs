import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

test('supervisor switches releases, restores previous release and stops its child', { timeout: 25000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'movieboxd-supervisor-'));
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  for (const name of ['one', 'two', 'broken']) {
    await mkdir(resolve(root, name, 'server'), { recursive: true });
    await writeFile(resolve(root, name, 'server/index.ts'), name === 'broken' ? 'process.exit(1)' :
      `import http from 'node:http'; http.createServer((q,r)=>r.end('${name}')).listen(${port},'127.0.0.1');`);
  }
  await symlink(resolve(root, 'one'), resolve(root, 'current'));
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'supervisor.mjs')], {
    env: { ...process.env, MOVIEBOXD_DEPLOY_ROOT: root }, stdio: 'pipe',
  });
  child.stdout.resume(); child.stderr.resume();
  const closed = new Promise(done => child.once('close', done));
  async function expectVersion(expected) {
    for (let n = 0; n < 75; n++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(300) });
        if (await response.text() === expected) return;
      } catch {}
      await delay(100);
    }
    assert.fail(`Version ${expected} did not start`);
  }
  async function switchTo(name) {
    await symlink(resolve(root, name), resolve(root, 'current.next'));
    await rename(resolve(root, 'current.next'), resolve(root, 'current'));
    await writeFile(resolve(root, 'restart.request'), String(Date.now()));
  }
  try {
    await expectVersion('one');
    await switchTo('two'); await expectVersion('two');
    await switchTo('broken'); await delay(1500);
    await switchTo('two'); await expectVersion('two');
  } finally {
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    await closed; clearTimeout(timeout);
    await rm(root, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }));
});
