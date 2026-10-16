// Checks the real production entry point and built assets, without calling TMDB.
// Run after npm run build. No .env file or real credentials are loaded.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const temporary = mkdtempSync(join(tmpdir(), "movieboxd-production-"));
const child = spawn(process.execPath, ["server/index.ts"], {
  cwd: resolve(import.meta.dirname, ".."),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "0",
    TMDB_CACHE_PATH: join(temporary, "cache", "tmdb.sqlite"),
    TMDB_API_KEY: "",
    TMDB_READ_ACCESS_TOKEN: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
let startupError: Error | undefined;
child.on("error", (error) => { startupError = error; });
const closed = new Promise<void>((done) => child.once("close", () => done()));

try {
  const deadline = Date.now() + 15_000;
  let port: string | undefined;
  while (!(port = output.match(/movieboxd API: http:\/\/[^:]+:(\d+)/)?.[1])) {
    if (startupError) throw startupError;
    assert.equal(child.exitCode, null, `Production server exited: ${output}`);
    assert.ok(Date.now() < deadline, `Production startup timed out: ${output}`);
    await delay(100);
  }
  const base = `http://127.0.0.1:${port}`;
  const get = (path: string) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, tmdbConfigured: false });

  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /text\/html/);
  const html = await home.text();
  const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
  assert.ok(asset, "Built JS bundle must be served, not the Vite development entry");
  const bundle = await get(asset);
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type") ?? "", /javascript/);
  for (const route of ["/title/movie/271110", "/person/6193"]) {
    const response = await get(route);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html, "Deep links must load the SPA");
  }
  const missing = await get("/api/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "NOT_FOUND");
  const unconfigured = await get("/api/home");
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, "TMDB_NOT_CONFIGURED");
  for (const privatePath of ["/.env", "/server/index.ts", "/package.json"]) {
    const response = await get(privatePath);
    assert.ok(response.status === 404 || await response.text() === html,
      `Source file must not be served: ${privatePath}`);
  }
  console.log("PRODUCTION SMOKE PASSED: startup, environment, SQLite, health, HTML/JS, deep links, API errors, private files. Live TMDB was not tested.");
} finally {
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await closed;
  clearTimeout(forceKill);
  rmSync(temporary, { recursive: true, force: true });
}
