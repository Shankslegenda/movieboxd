import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirectFinder } from "../server/direct-links.ts";
import { buildApp } from "../server/app.ts";
import { safeDirectUrl } from "../shared/direct-links.ts";
const target = {
  id: 27205,
  type: "movie" as const,
  names: ["Начало", "Inception"],
  year: "2010",
};
const path = "/23767--nachalo.html";
const origin = "https://kinogo2026.com";
const empty =
  '<form class="js-lightsearch-form"></form><div id="dle-content"></div>';
const resultHtml = (name = "Начало (2010)", year = "2010", url = path) =>
  `<form class="js-lightsearch-form"></form><div id="dle-content"><div class="shortstory"><div class="shortstory__title"><a href="${url}"><h2>${name}</h2></a></div><a href="/xfsearch/year-teg-xfsearch/${year}/">${year}</a></div></div>`;
function detail({
  title = "Начало (2010)",
  year = "2010",
  type = "movie",
  canonical = origin + path,
  player = true,
} = {}) {
  return `<link rel="canonical" href="${canonical}"><div class="fullstory__title"><h1>${title}</h1></div><div class="m_info"><a href="/xfsearch/year-teg-xfsearch/${year}/">${year}</a><a href="/${type === "movie" ? "filmy" : "serialy"}/">Тип</a></div>${player ? '<div class="video-container"><iframe data-src="https://player.example/test"></iframe></div>' : ""}`;
}
const html = (value: string) =>
  new Response(value, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const mock = (
  fn: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) =>
  ((url: any, init?: RequestInit) =>
    [
      "https://ifilm.space",
      "https://api.nechego.pw",
      "https://nechego.pw",
    ].includes(new URL(String(url)).origin)
      ? Promise.resolve(Response.json([]))
      : Promise.resolve(fn(new URL(String(url)), init))) as typeof fetch;
const kinogo = (
  result: Awaited<ReturnType<ReturnType<typeof createDirectFinder>>>,
) => result.sources.find((s) => s.sourceId === "kinogo")!;
test("direct finder searches the supplied Kinogo then verifies a title page; cache coalesces requests", async () => {
  let calls = 0;
  const finder = createDirectFinder(
    mock((url, init) => {
      calls++;
      assert.equal(url.origin, origin);
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      return html(
        url.pathname.startsWith("/search/") ? resultHtml() : detail(),
      );
    }),
  );
  const [a, b] = await Promise.all([finder(target), finder(target)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 2);
  assert.equal(kinogo(a).status, "found");
  assert.equal(kinogo(a).url, origin + path);
  assert.equal(kinogo(a).matchedBy, "title_year");
  assert.equal(
    a.sources.find((s) => s.sourceId === "hdrezka")?.status,
    "needs_source",
  );
  await finder(target);
  assert.equal(calls, 2);
});
test("remakes and partial titles are rejected before fetching detail pages", async () => {
  let detailCalls = 0;
  const finder = createDirectFinder(
    mock((url) => {
      if (!url.pathname.startsWith("/search/")) detailCalls++;
      return html(
        resultHtml("Начало (2020)", "2020") +
          resultHtml("Начало времен (2010)"),
      );
    }),
  );
  const result = kinogo(await finder(target));
  assert.equal(result.status, "not_found");
  assert.equal(result.url, null);
  assert.equal(detailCalls, 0);
});
test("wrong detail date, type, canonical URL, title or missing player never produce an offer", async () => {
  for (const overrides of [
    { year: "2020" },
    { type: "tv" },
    { canonical: "https://evil.test" + path },
    { title: "Другое кино (2010)" },
    { player: false },
  ]) {
    const find = createDirectFinder(
      mock((url) =>
        html(
          url.pathname.startsWith("/search/")
            ? resultHtml()
            : detail(overrides),
        ),
      ),
    );
    assert.equal(kinogo(await find(target)).status, "not_found");
  }
});
test("TV seasons match the first air year and remain distinct from a movie", async () => {
  const find = createDirectFinder(
    mock((url) =>
      html(
        url.pathname.startsWith("/search/")
          ? resultHtml("Начало (1-2 сезон)", "2022")
          : detail({ title: "Начало (1-2 сезон)", year: "2022", type: "tv" }),
      ),
    ),
  );
  assert.equal(
    kinogo(
      await find({
        ...target,
        type: "tv",
        names: ["Начало", "Reset"],
        year: "2022",
      }),
    ).status,
    "found",
  );
  assert.equal(
    kinogo(await find({ ...target, year: "2022" })).status,
    "not_found",
  );
});
test("original title fallback searches the source and bilingual titles are recognized", async () => {
  const find = createDirectFinder(
    mock((url) =>
      html(
        url.pathname.startsWith("/search/")
          ? decodeURIComponent(url.pathname).endsWith("Inception")
            ? resultHtml("Начало / Inception (2010)")
            : empty
          : detail({ title: "Начало / Inception (2010)" }),
      ),
    ),
  );
  assert.equal(kinogo(await find(target)).status, "found");
});
test("blocked source is explicit and retries are not trapped in the cache", async () => {
  let blocked = true;
  const find = createDirectFinder(
    mock((url) =>
      blocked
        ? new Response("", { status: 403 })
        : html(url.pathname.startsWith("/search/") ? resultHtml() : detail()),
    ),
  );
  assert.equal(kinogo(await find(target)).status, "blocked");
  blocked = false;
  assert.equal(kinogo(await find(target)).status, "found");
});
test("challenges, unexpected content, network failures and oversized HTML are errors, not empty results", async () => {
  for (const reply of [
    () => html("<h1>Checking your browser</h1>"),
    () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
    () => html("x".repeat(1_500_001)),
    () => {
      throw new Error("network failed");
    },
  ]) {
    const find = createDirectFinder(mock(reply));
    assert.equal(kinogo(await find(target)).status, "unavailable");
  }
});
test("cross-origin redirects and malicious links cannot cause arbitrary server requests", async () => {
  let calls = 0;
  const find = createDirectFinder(
    mock(() => {
      calls++;
      return new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1:3001/api/health" },
      });
    }),
  );
  assert.equal(kinogo(await find(target)).status, "unavailable");
  assert.equal(calls, 1);
  for (const value of [
    "javascript:alert(1)",
    "http://kinogo2026.com" + path,
    "https://kinogo2026.com.evil.test" + path,
    "https://user:pass@kinogo2026.com" + path,
    "https://kinogo2026.com:444" + path,
    origin + "/search/test",
    origin + path + "?redirect=evil",
    origin + path + "#watch",
    "//127.0.0.1" + path,
    "https://kinogo.lifestyle/filmy/inception-2010",
    "https://hdrezka.asia/filmy/inception-2010",
  ])
    assert.equal(safeDirectUrl(value, "kinogo"), null, value);
  assert.equal(safeDirectUrl(path, "hdrezka"), null);
  assert.equal(safeDirectUrl(path, "unknown"), null);
});
test("route obtains trusted TMDB metadata, validates ids and rejects adult movies", async (t) => {
  const app = buildApp({
    token: "secret-test-token",
    fetcher: mock(() =>
      Response.json({
        id: 27205,
        title: "Начало",
        original_title: "Inception",
        release_date: "2010-07-15",
      }),
    ),
    directFetcher: mock((url) =>
      html(url.pathname.startsWith("/search/") ? resultHtml() : detail()),
    ),
  });
  t.after(() => app.close());
  const r = await app.inject("/api/direct-links/movie/27205");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().sources[0].status, "found");
  assert.ok(!r.body.includes("secret-test-token"));
  for (const p of [
    "/api/direct-links/person/1",
    "/api/direct-links/movie/0",
    "/api/direct-links/tv/nope",
    "/api/direct-links/movie/2147483648",
  ])
    assert.equal((await app.inject(p)).statusCode, 400);
  const adult = buildApp({
    token: "test",
    fetcher: mock(() => Response.json({ id: 27205, adult: true })),
  });
  t.after(() => adult.close());
  assert.equal(
    (await adult.inject("/api/direct-links/movie/27205")).statusCode,
    404,
  );
});


test("a failed translated search still tries the original title", async () => {
  const finder = createDirectFinder(mock(url => {
    if (decodeURIComponent(url.pathname).endsWith("Начало")) return new Response("", { status: 503 });
    return html(url.pathname.startsWith("/search/") ? resultHtml() : detail());
  }));
  assert.equal(kinogo(await finder(target)).status, "found");
});
