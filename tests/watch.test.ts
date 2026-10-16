import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server/app.ts";
import { safeAvailabilityLink } from "../shared/watch.ts";
const regions = {
  results: ["US", "GB", "DE", "CA", "FR"].map((iso_3166_1) => ({
    iso_3166_1,
    native_name: iso_3166_1,
  })),
};
const provider = (provider_id: number, provider_name = "Test Platform") => ({
  provider_id,
  provider_name,
  logo_path: "/logo.jpg",
  display_priority: 1,
});
const regional = {
  link: "https://www.themoviedb.org/movie/27205-inception/watch?locale=US",
  free: [provider(1)],
  ads: [provider(2)],
  flatrate: [provider(3), provider(3)],
  rent: [provider(3)],
  buy: [provider(4)],
};
function makeApp(handler: (url: URL) => Response | Promise<Response>) {
  return buildApp({
    token: "test-only",
    fetcher: ((url: any) =>
      Promise.resolve(handler(new URL(String(url))))) as typeof fetch,
  });
}
function responding(data: unknown) {
  return makeApp((url) =>
    Response.json(url.pathname.endsWith("/regions") ? regions : data),
  );
}
test("movie discovery keeps all categories distinct and sorts free before paid", async (t) => {
  const app = responding({ id: 27205, results: { US: regional } });
  t.after(() => app.close());
  const response = await app.inject("/api/watch/movie/27205?region=US");
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.deepEqual(
    data.providers.map((p: any) => p.category),
    ["free", "ads", "flatrate", "rent", "buy"],
  );
  assert.equal(data.hasFree, true);
  assert.equal(data.hasAds, true);
  assert.equal(data.providers.filter((p: any) => p.id === 3).length, 2);
  assert.equal(data.providers[0].verification, "reported_by_source");
  assert.equal(data.providers[0].source, "TMDB / JustWatch");
  assert.ok(
    data.providers.every(
      (p: any) => p.linkType === "regional_availability" && p.region === "US",
    ),
  );
});
test("TV uses its own endpoint and correct title link", async (t) => {
  let path = "";
  const app = makeApp((url) => {
    if (url.pathname.endsWith("/regions")) return Response.json(regions);
    path = url.pathname;
    return Response.json({
      id: 1399,
      results: {
        GB: {
          link: "https://www.themoviedb.org/tv/1399/watch?locale=GB",
          flatrate: [provider(3)],
        },
      },
    });
  });
  t.after(() => app.close());
  const result = await app.inject("/api/watch/tv/1399?region=GB");
  assert.equal(result.statusCode, 200);
  assert.equal(path, "/3/tv/1399/watch/providers");
  assert.equal(result.json().hasFree, false);
  assert.equal(result.json().providers[0].category, "flatrate");
});
test("switching regions never mixes results and reuses cached multi-country payload", async (t) => {
  let calls = 0;
  const app = makeApp((url) => {
    calls++;
    return Response.json(
      url.pathname.endsWith("/regions")
        ? regions
        : {
            id: 27205,
            results: {
              US: regional,
              GB: { flatrate: [provider(9, "UK Platform")] },
            },
          },
    );
  });
  t.after(() => app.close());
  const us = (await app.inject("/api/watch/movie/27205?region=US")).json();
  const gb = (await app.inject("/api/watch/movie/27205?region=GB")).json();
  assert.equal(us.providers[0].region, "US");
  assert.equal(gb.providers[0].name, "UK Platform");
  assert.equal(gb.providers[0].region, "GB");
  assert.equal(calls, 2);
});
test("default KZ reports absent coverage; supported country without providers stays empty", async (t) => {
  const app = responding({ id: 27205, results: {} });
  t.after(() => app.close());
  const kz = (await app.inject("/api/watch/movie/27205")).json();
  assert.equal(kz.region, "KZ");
  assert.equal(kz.regionSupported, false);
  assert.deepEqual(kz.providers, []);
  const us = (await app.inject("/api/watch/movie/27205?region=US")).json();
  assert.equal(us.regionSupported, true);
  assert.equal(us.hasFree, false);
  assert.equal(us.availabilityLink, null);
  const list = (await app.inject("/api/watch/regions")).json().regions;
  assert.equal(list[0].code, "KZ");
  assert.ok(list.some((r: any) => r.code === "FR"));
});
test("country and identifier validation rejects invalid requests", async (t) => {
  const app = responding({ id: 27205, results: {} });
  t.after(() => app.close());
  for (const path of [
    "/api/watch/movie/27205?region=ZZ",
    "/api/watch/movie/27205?region=us",
    "/api/watch/movie/27205?region=USA",
    "/api/watch/movie/27205?region=",
    "/api/watch/person/1",
    "/api/watch/tv/-1",
    "/api/watch/movie/nope",
    "/api/watch/movie/2147483648",
  ])
    assert.equal((await app.inject(path)).statusCode, 400, path);
});
test("provider language claims stay unknown even if unrelated upstream language fields exist", async (t) => {
  const app = responding({
    id: 27205,
    original_language: "en",
    results: {
      US: {
        free: [{ ...provider(1), audio: ["en"], subtitles: ["en", "ru"] }],
      },
    },
  });
  t.after(() => app.close());
  const p = (await app.inject("/api/watch/movie/27205?region=US")).json()
    .providers[0];
  assert.deepEqual(p.audio, { status: "unknown", languages: [] });
  assert.deepEqual(p.subtitles, { status: "unknown", languages: [] });
});
test("unsafe, wrong-title and provider-homepage links are never exposed", async (t) => {
  for (const link of [
    "javascript:alert(1)",
    "https://evil.example/movie/27205/watch",
    "https://www.themoviedb.org.evil.example/movie/27205/watch",
    "https://user:pass@www.themoviedb.org/movie/27205/watch",
    "http://www.themoviedb.org/movie/27205/watch",
    "https://www.themoviedb.org/movie/5/watch",
    "https://www.themoviedb.org/tv/27205/watch",
    "https://netflix.com/",
    "https://www.themoviedb.org:123/movie/27205/watch",
  ])
    assert.equal(safeAvailabilityLink(link, "movie", 27205), null, link);
  const app = responding({
    id: 27205,
    results: { US: { link: "javascript:alert(1)", free: [provider(1)] } },
  });
  t.after(() => app.close());
  const p = (await app.inject("/api/watch/movie/27205?region=US")).json()
    .providers[0];
  assert.equal(p.link, null);
  assert.equal(p.linkType, "unavailable");
});
test("missing link never creates a guessed title or provider URL", async (t) => {
  const app = responding({
    id: 27205,
    results: { US: { buy: [provider(4)] } },
  });
  t.after(() => app.close());
  const data = (await app.inject("/api/watch/movie/27205?region=US")).json();
  assert.equal(data.providers[0].link, null);
  assert.equal(data.hasFree, false);
  assert.equal(data.hasAds, false);
});
test("TMDB failure is an error, never an empty availability result", async (t) => {
  for (const [upstream, expected] of [
    [401, 503],
    [429, 429],
    [404, 404],
    [500, 502],
  ]) {
    const app = makeApp((url) =>
      url.pathname.endsWith("/regions")
        ? Response.json(regions)
        : new Response("", { status: upstream }),
    );
    t.after(() => app.close());
    const r = await app.inject("/api/watch/movie/27205?region=US");
    assert.equal(r.statusCode, expected);
    assert.equal(r.json().providers, undefined);
  }
});
test("malformed provider response is rejected instead of claiming no offers", async (t) => {
  for (const body of [
    {},
    { id: 27205, results: null },
    { id: 3, results: {} },
    { id: 27205, results: { US: { free: "bad" } } },
    { id: 27205, results: { US: { free: [{}] } } },
  ]) {
    const app = responding(body);
    t.after(() => app.close());
    const r = await app.inject("/api/watch/movie/27205?region=US");
    assert.equal(r.statusCode, 502);
    assert.equal(r.json().code, "TMDB_INVALID_RESPONSE");
  }
});
test("simultaneous provider requests coalesce region and title fetches", async (t) => {
  let calls = 0;
  const app = makeApp(async (url) => {
    calls++;
    await new Promise((r) => setTimeout(r, 15));
    return Response.json(
      url.pathname.endsWith("/regions")
        ? regions
        : { id: 27205, results: { US: regional } },
    );
  });
  t.after(() => app.close());
  const responses = await Promise.all([
    app.inject("/api/watch/movie/27205?region=US"),
    app.inject("/api/watch/movie/27205?region=GB"),
  ]);
  assert.ok(responses.every((r) => r.statusCode === 200));
  assert.equal(calls, 2);
});
