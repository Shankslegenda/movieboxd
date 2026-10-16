import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirectFinder } from "../server/direct-links.ts";
import { safeDirectUrl } from "../shared/direct-links.ts";

const target = {
  id: 27205,
  type: "movie" as const,
  names: ["Начало", "Inception"],
  year: "2010",
};
const indexItem = {
  kind: "title",
  title: "Начало",
  original: "Inception",
  year: "2010",
  url: "/inception/",
};
const searchItem = {
  title: "Начало",
  type: "movie",
  year: 2010,
  slug: "inception",
  players: [{ type: "cdnvideohub", url: "kp:447301" }],
};
const html = (value: string) =>
  new Response(value, { headers: { "content-type": "text/html" } });
function detail(
  source: "ifilm" | "nechego",
  changes: Record<string, unknown> = {},
  player = true,
) {
  const url =
    source === "ifilm"
      ? "https://ifilm.space/inception/"
      : "https://nechego.pw/inception";
  return `<link rel="canonical" href="${url}"><h1>Начало</h1><script type="application/ld+json">${JSON.stringify({ "@type": "Movie", name: "Начало", alternateName: "Inception", datePublished: "2010-01-01", url, ...changes })}</script>${player ? '<section id="player"><ins data-publisher-id="123" data-id="456"></ins></section>' : ""}`;
}
const fixtures = (url: URL) => {
  if (url.hostname === "kinogo2026.com")
    return html(
      '<form class="js-lightsearch-form"></form><div id="dle-content"></div>',
    );
  if (url.pathname === "/index.json") return Response.json([indexItem]);
  if (url.hostname === "api.nechego.pw") return Response.json([searchItem]);
  return html(detail(url.hostname === "ifilm.space" ? "ifilm" : "nechego"));
};
function mock(
  override?: (url: URL, init?: RequestInit) => Response | undefined,
) {
  return (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    assert.equal(new Headers(init?.headers).get("Cookie"), null);
    assert.equal(init?.redirect, "manual");
    return override?.(url, init) ?? fixtures(url);
  }) as typeof fetch;
}
const source = (
  r: Awaited<ReturnType<ReturnType<typeof createDirectFinder>>>,
  id: string,
) => r.sources.find((s) => s.sourceId === id)!;

test("both new sources discover and verify direct pages; index and title requests coalesce", async () => {
  const calls: string[] = [];
  const find = createDirectFinder(
    mock((url, init) => {
      calls.push(url.href);
      if (url.hostname === "api.nechego.pw") {
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), { query: "Начало" });
      }
      return undefined;
    }),
  );
  const [a, b] = await Promise.all([find(target), find(target)]);
  assert.deepEqual(a, b);
  assert.equal(source(a, "ifilm").url, "https://ifilm.space/inception/");
  assert.equal(source(a, "nechego").url, "https://nechego.pw/inception");
  assert.equal(source(a, "ifilm").matchedBy, "title_year");
  const before = calls.length;
  await find(target);
  assert.equal(calls.length, before);
  await find({ ...target, id: 2 });
  assert.equal(calls.filter((x) => x.endsWith("/index.json")).length, 1);
});

test("new sources reject remakes, partial names, series and missing players before page fetch", async () => {
  for (const bad of [
    { year: "2020" },
    { title: "Начало времён", original: "Other" },
  ]) {
    let pages = 0;
    const find = createDirectFinder(
      mock((url) => {
        if (url.pathname === "/index.json")
          return Response.json([{ ...indexItem, ...bad }]);
        if (url.hostname === "ifilm.space") pages++;
        return undefined;
      }),
    );
    assert.equal(source(await find(target), "ifilm").status, "not_found");
    assert.equal(pages, 0);
  }
  for (const bad of [
    { year: 2020 },
    { title: "Начало времён" },
    { type: "series" },
    { players: [] },
    { slug: "//evil.test/x" },
  ]) {
    let pages = 0;
    const find = createDirectFinder(
      mock((url) => {
        if (url.hostname === "api.nechego.pw")
          return Response.json([{ ...searchItem, ...bad }]);
        if (url.hostname === "nechego.pw") pages++;
        return undefined;
      }),
    );
    assert.equal(source(await find(target), "nechego").status, "not_found");
    assert.equal(pages, 0);
  }
});

test("verified search alone is insufficient: detail metadata must match title, year, type and URL", async () => {
  for (const id of ["ifilm", "nechego"] as const) {
    const host = id === "ifilm" ? "ifilm.space" : "nechego.pw";
    for (const bad of [
      { name: "Other", alternateName: "Other" },
      { datePublished: "2020" },
      { "@type": "TVSeries" },
      { url: "https://evil.test/inception" },
    ]) {
      const find = createDirectFinder(
        mock((url) =>
          url.hostname === host && url.pathname !== "/index.json"
            ? html(detail(id, bad))
            : undefined,
        ),
      );
      assert.equal(source(await find(target), id).status, "not_found");
    }
  }
  const noPlayer = createDirectFinder(
    mock((url) =>
      url.hostname === "ifilm.space" && url.pathname !== "/index.json"
        ? html(detail("ifilm", {}, false))
        : undefined,
    ),
  );
  assert.equal(source(await noPlayer(target), "ifilm").status, "not_found");
});

test("a blocked source does not suppress other links and can recover on retry", async () => {
  let blocked = true;
  const find = createDirectFinder(
    mock((url) =>
      blocked && url.hostname === "ifilm.space"
        ? new Response("", { status: 403 })
        : undefined,
    ),
  );
  const failed = await find(target);
  assert.equal(source(failed, "ifilm").status, "blocked");
  assert.equal(source(failed, "nechego").status, "found");
  blocked = false;
  assert.equal(source(await find(target), "ifilm").status, "found");
});

test("invalid JSON, challenge responses and oversized catalogs are errors instead of no matches", async () => {
  for (const reply of [
    () => Response.json({ error: "challenge" }),
    () => html("<h1>Checking your browser</h1>"),
    () =>
      new Response("[", { headers: { "content-type": "application/json" } }),
    () => Response.json("x".repeat(12_000_000)),
  ]) {
    const find = createDirectFinder(
      mock((url) => (url.pathname === "/index.json" ? reply() : undefined)),
    );
    assert.equal(source(await find(target), "ifilm").status, "unavailable");
  }
});

test("source URLs are isolated and API redirects never forward search bodies to another host", async () => {
  const visited: string[] = [];
  const find = createDirectFinder(
    mock((url) => {
      visited.push(url.hostname);
      if (url.hostname === "api.nechego.pw")
        return new Response("", {
          status: 307,
          headers: { location: "http://127.0.0.1/private" },
        });
      return undefined;
    }),
  );
  assert.equal(source(await find(target), "nechego").status, "unavailable");
  assert.ok(!visited.includes("127.0.0.1"));
  for (const id of ["ifilm", "nechego"] as const) {
    const base =
      id === "ifilm"
        ? "https://ifilm.space/inception/"
        : "https://nechego.pw/inception";
    assert.equal(safeDirectUrl(base, id), base);
    for (const bad of [
      base + "?redirect=evil",
      base + "#player",
      base.replace("https:", "http:"),
      base.replace("https://", "https://user:pass@"),
      base.replace("/inception", "/search/inception"),
      "javascript:alert(1)",
      "https://evil.test/inception/",
    ])
      assert.equal(safeDirectUrl(bad, id), null);
    assert.equal(
      safeDirectUrl(base, id === "ifilm" ? "nechego" : "ifilm"),
      null,
    );
  }
});

test("original title fallback and a series with matching first year are supported", async () => {
  const fallback = createDirectFinder(
    mock((url, init) =>
      url.hostname === "api.nechego.pw" &&
      JSON.parse(String(init?.body)).query === "Начало"
        ? Response.json([])
        : undefined,
    ),
  );
  assert.equal(source(await fallback(target), "nechego").status, "found");
  const series = createDirectFinder(
    mock((url) => {
      if (url.hostname === "api.nechego.pw")
        return Response.json([{ ...searchItem, type: "series" }]);
      if (
        ["ifilm.space", "nechego.pw"].includes(url.hostname) &&
        url.pathname !== "/index.json"
      )
        return html(
          detail(url.hostname === "ifilm.space" ? "ifilm" : "nechego", {
            "@type": "TVSeries",
          }),
        );
      return undefined;
    }),
  );
  const r = await series({ ...target, type: "tv" });
  assert.equal(source(r, "ifilm").status, "found");
  assert.equal(source(r, "nechego").status, "found");
});


test("Nechego uses its public sitemap when its search API returns a CAPTCHA", async () => {
  const playerItem = { ...searchItem };
  const flight = `<script>self.__next_f.push(${JSON.stringify([1, "1f:" + JSON.stringify(["$", "Component", null, { item: playerItem }]) + "\n"])})</script>`;
  const find = createDirectFinder(mock(url => {
    if (url.hostname === "api.nechego.pw") return new Response("<title>CrowdSec Captcha</title>", { status: 404 });
    if (url.pathname === "/sitemap.xml") return new Response('<urlset><url><loc>https://nechego.pw/inception</loc></url><url><loc>https://evil.test/inception</loc></url><url><loc>https://nechego.pw/inception/player</loc></url></urlset>', { headers: { "content-type": "text/xml" } });
    if (url.hostname === "nechego.pw") return html(detail("nechego") + flight);
    return undefined;
  }));
  const result = source(await find(target), "nechego");
  assert.equal(result.status, "found");
  assert.equal(result.url, "https://nechego.pw/inception");
});

test("a sitemap URL never counts as a match without matching page and player metadata", async () => {
  for (const item of [{ ...searchItem, year: 2020 }, { ...searchItem, players: [] }, { ...searchItem, slug: "other-film" }]) {
    const flight = `<script>self.__next_f.push(${JSON.stringify([1, "1f:" + JSON.stringify({ item }) + "\n"])})</script>`;
    const find = createDirectFinder(mock(url => {
      if (url.hostname === "api.nechego.pw") return new Response("<title>CrowdSec Captcha</title>", { status: 404 });
      if (url.pathname === "/sitemap.xml") return new Response('<urlset><url><loc>https://nechego.pw/inception</loc></url></urlset>', { headers: { "content-type": "text/xml" } });
      if (url.hostname === "nechego.pw") return html(detail("nechego") + flight);
      return undefined;
    }));
    const result = source(await find(target), "nechego");
    assert.equal(result.status, "blocked");
    assert.equal(result.url, null);
  }
});
