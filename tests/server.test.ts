import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server/app.ts";
import { createTmdb } from "../server/tmdb.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const token = "test-only-token";
const fetcher = (
  fn: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) =>
  ((url: any, init?: RequestInit) =>
    Promise.resolve(fn(new URL(String(url)), init))) as typeof fetch;
const movie = {
  id: 550,
  title: "Бойцовский клуб",
  media_type: "movie",
  adult: false,
};
const page = { results: [movie], page: 1, total_pages: 3, total_results: 42 };

test("without a key health works, catalogue returns actionable 503", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  assert.deepEqual((await app.inject("/api/health")).json(), {
    ok: true,
    tmdbConfigured: false,
  });
  const response = await app.inject("/api/home");
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "TMDB_NOT_CONFIGURED");
});
test("health remains available when a client's API request limit is exhausted", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  for (let i = 0; i < 120; i++) await app.inject("/api/home");
  assert.equal((await app.inject("/api/home")).statusCode, 429);
  assert.equal((await app.inject("/api/health")).statusCode, 200);
});
test("hosting proxy separates client limits without trusting spoofed leftmost addresses", async (t) => {
  const app = buildApp({ trustHostingProxy: true });
  t.after(() => app.close());
  const request = (forwarded: string) => app.inject({
    url: "/api/home", headers: { "x-forwarded-for": forwarded },
  });
  for (let i = 0; i < 120; i++) await request("198.51.100.1");
  assert.equal((await request("203.0.113.99, 198.51.100.1")).statusCode, 429);
  assert.equal((await request("198.51.100.2")).statusCode, 503);
});
test("search uses authentication, encodes input, paginates and removes people/adult results", async (t) => {
  let called = 0;
  const app = buildApp({
    token,
    fetcher: fetcher((url, init) => {
      called++;
      assert.equal(url.origin, "https://api.themoviedb.org");
      assert.equal(url.pathname, "/3/search/multi");
      assert.equal(url.searchParams.get("query"), "Дюна & море");
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(url.searchParams.get("include_adult"), "false");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${token}`,
      );
      return Response.json({
        ...page,
        results: [
          movie,
          { id: 2, media_type: "person" },
          { ...movie, id: 3, adult: true },
        ],
      });
    }),
  });
  t.after(() => app.close());
  const result = await app.inject(
    "/api/search?query=" + encodeURIComponent("Дюна & море") + "&page=2",
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().results, [movie]);
  await app.inject(
    "/api/search?query=" + encodeURIComponent("Дюна & море") + "&page=2",
  );
  assert.equal(called, 1, "repeated searches use SQLite cache");
});
test("validates request boundaries before contacting TMDB", async (t) => {
  let called = 0;
  const app = buildApp({
    token,
    fetcher: fetcher(() => {
      called++;
      return Response.json(page);
    }),
  });
  t.after(() => app.close());
  for (const path of [
    "/api/search",
    "/api/search?query=%20",
    "/api/search?query=x&page=0",
    "/api/search?query=x&page=501",
    "/api/search?query=x&type=person",
    "/api/catalog/unknown",
    "/api/title/person/1",
    "/api/title/movie/-1",
    "/api/title/movie/nope",
    "/api/search?query=" + "x".repeat(201),
  ]) {
    assert.equal((await app.inject(path)).statusCode, 400, path);
  }
  assert.equal(called, 0);
});
test("upstream auth, rate limit, missing title and network failure stay distinguishable and do not leak credentials", async (t) => {
  for (const [upstream, status, code] of [
    [401, 503, "TMDB_AUTH_ERROR"],
    [429, 429, "TMDB_RATE_LIMIT"],
    [404, 404, "NOT_FOUND"],
    [500, 502, "TMDB_ERROR"],
  ] as const) {
    const app = buildApp({
      token,
      fetcher: fetcher(() => new Response(token, { status: upstream })),
    });
    t.after(() => app.close());
    const result = await app.inject("/api/title/movie/550");
    assert.equal(result.statusCode, status);
    assert.equal(result.json().code, code);
    assert.equal(result.body.includes(token), false);
  }
  const app = buildApp({
    token,
    fetcher: fetcher(() => {
      throw new Error("network " + token);
    }),
  });
  t.after(() => app.close());
  const result = await app.inject("/api/search?query=test");
  assert.equal(result.statusCode, 502);
  assert.equal(result.json().code, "TMDB_UNREACHABLE");
  assert.ok(!result.body.includes(token));
});
test("home tolerates one failed shelf and assigns media types correctly", async (t) => {
  const app = buildApp({
    token,
    fetcher: fetcher((url) =>
      url.pathname === "/3/movie/top_rated"
        ? new Response("", { status: 500 })
        : Response.json({
            ...page,
            results: [{ ...movie, media_type: undefined }],
          }),
    ),
  });
  t.after(() => app.close());
  const result = await app.inject("/api/home");
  assert.equal(result.statusCode, 200);
  const { sections } = result.json();
  assert.equal(sections.length, 6);
  assert.ok(sections.find((s: any) => s.id === "top").error);
  assert.equal(
    sections.find((s: any) => s.id === "tv").results[0].media_type,
    "tv",
  );
});
test("all failed shelves return 502 rather than an empty success", async (t) => {
  const app = buildApp({
    token,
    fetcher: fetcher(() => new Response("", { status: 500 })),
  });
  t.after(() => app.close());
  assert.equal((await app.inject("/api/home")).statusCode, 502);
});
test("details preserve cast/trailer data and reject adult titles", async (t) => {
  const app = buildApp({
    token,
    fetcher: fetcher((url) => {
      assert.equal(
        url.searchParams.get("append_to_response"),
        "credits,videos,recommendations",
      );
      return Response.json({
        ...movie,
        adult: url.pathname.endsWith("/1"),
        credits: { cast: [] },
        videos: { results: [] },
        recommendations: page,
      });
    }),
  });
  t.after(() => app.close());
  const result = await app.inject("/api/title/movie/550");
  assert.equal(result.json().media_type, "movie");
  assert.deepEqual(result.json().credits, { cast: [] });
  assert.equal((await app.inject("/api/title/movie/1")).statusCode, 404);
});
test("SQLite cache persists across restarts, expires, and excludes credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "movieboxd-"));
  const database = join(dir, "cache.sqlite");
  let calls = 0;
  const options = {
    token,
    database,
    fetcher: fetcher(() => {
      calls++;
      return Response.json(page);
    }),
  };
  const first = createTmdb(options);
  await first.get("/movie/popular");
  first.close();
  const second = createTmdb(options);
  assert.deepEqual(await second.get("/movie/popular"), page);
  second.close();
  assert.equal(calls, 1);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  assert.ok(
    !JSON.stringify(db.prepare("SELECT * FROM cache").all()).includes(token),
  );
  db.exec("UPDATE cache SET expires=0");
  db.close();
  const third = createTmdb(options);
  await third.get("/movie/popular");
  third.close();
  assert.equal(calls, 2);
  rmSync(dir, { recursive: true });
});
test("identical in-flight requests share one upstream call", async () => {
  let calls = 0;
  const client = createTmdb({
    token,
    fetcher: fetcher(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return Response.json(page);
    }),
  });
  await Promise.all([
    client.get("/movie/popular"),
    client.get("/movie/popular"),
  ]);
  assert.equal(calls, 1);
  client.close();
});
