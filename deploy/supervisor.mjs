// Runs inside alwaysdata's web service. No API key or SSH access is required.
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.env.MOVIEBOXD_DEPLOY_ROOT;
if (!root) throw new Error('MOVIEBOXD_DEPLOY_ROOT is required');
let child, loadedPath, loadedRequest, busy = false, stopping = false;
let lastStart = 0;
const request = () => {
  try { return readFileSync(resolve(root, 'restart.request'), 'utf8'); }
  catch { return ''; }
};
async function stopChild() {
  const previous = child;
  if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
  await new Promise(done => {
    const timeout = setTimeout(() => previous.kill('SIGKILL'), 8000);
    previous.once('close', () => { clearTimeout(timeout); done(); });
    previous.kill('SIGTERM');
  });
}
async function reconcile() {
  if (busy || stopping) return;
  busy = true;
  try {
    const directory = realpathSync(resolve(root, 'current'));
    const requested = request();
    if (child && loadedPath === directory && loadedRequest === requested) return;
    if (!child && Date.now() - lastStart < 3000) return;
    await stopChild();
    if (stopping) return;
    loadedPath = directory;
    loadedRequest = requested;
    lastStart = Date.now();
    const processChild = spawn(process.execPath, ['server/index.ts'], {
      cwd: directory, env: process.env, stdio: 'inherit',
    });
    child = processChild;
    processChild.once('error', () => console.error('MOVIEBOXD_PROCESS_START_FAILED'));
    processChild.once('close', () => { if (child === processChild) child = undefined; });
    console.log('MOVIEBOXD_PROCESS_STARTED', directory.split('/').at(-1));
  } catch (error) {
    console.error('MOVIEBOXD_SUPERVISOR_ERROR', error.code ?? error.name);
  } finally { busy = false; }
}
const interval = setInterval(reconcile, 1000);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, async () => {
  stopping = true;
  clearInterval(interval);
  await stopChild();
  process.exit(0);
});
await reconcile();
