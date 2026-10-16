import { load } from "cheerio";
import type { FastifyInstance } from "fastify";
import { ApiError, type createTmdb } from "./tmdb.ts";
import {
  directSources,
  safeDirectUrl,
  type DirectLinksResult,
  type DirectSourceResult,
} from "../shared/direct-links.ts";

type Source = (typeof directSources)[number];
type Target = {
  id: number;
  type: "movie" | "tv";
  names: string[];
  year: string;
};
class SourceError extends Error {
  status: "blocked" | "unavailable";
  constructor(status: "blocked" | "unavailable") {
    super(status);
    this.status = status;
  }
}
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\(\d{4}\)\s*$/, "")
    .replace(/\(\d+(?:\s*[-–]\s*\d+)?\s*сезон(?:а|ов)?\)\s*$/, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

async function readResource(
  url: string,
  source: Source,
  fetcher: typeof fetch,
  signal: AbortSignal,
  redirects = 0,
  options: { json?: boolean; maxBytes?: number; body?: string } = {},
): Promise<string> {
  const origin = new URL(url).origin;
  const isSearchApi =
    source.id === "nechego" &&
    origin === "https://api.nechego.pw" &&
    new URL(url).pathname === "/search/items";
  if (origin !== source.origin && !isSearchApi)
    throw new SourceError("unavailable");
  const response = await fetcher(url, {
    redirect: "manual",
    signal,
    headers: {
      Accept: options.json ? "application/json" : "text/html",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { method: "POST", body: options.body } : {}),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects >= 2) throw new SourceError("unavailable");
    const next = new URL(location, url);
    if (
      options.body ||
      next.origin !== origin ||
      next.username ||
      next.password
    )
      throw new SourceError("unavailable");
    return readResource(
      next.href,
      source,
      fetcher,
      signal,
      redirects + 1,
      options,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceError(
      [403, 429].includes(response.status) ? "blocked" : "unavailable",
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.includes(options.json ? "application/json" : "text/html")
  ) {
    await response.body?.cancel();
    throw new SourceError("unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError("unavailable");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > (options.maxBytes ?? 1_500_000)) {
        await reader.cancel();
        throw new SourceError("unavailable");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
const readHtml = (
  url: string,
  source: Source,
  fetcher: typeof fetch,
  signal: AbortSignal,
) => readResource(url, source, fetcher, signal);
type CatalogItem = {
  title: string;
  original?: string;
  year: string;
  url: string;
};
// The site's own public search index is shared across titles, never downloaded per card.
function createIfilmCatalog(fetcher: typeof fetch) {
  let cached: { items: CatalogItem[]; expires: number } | undefined;
  let pending: Promise<CatalogItem[]> | undefined;
  return async (signal: AbortSignal) => {
    if (cached && cached.expires > Date.now()) return cached.items;
    if (pending) return pending;
    pending = (async () => {
      const source = directSources.find((s) => s.id === "ifilm")!;
      const data: unknown = JSON.parse(
        await readResource(
          `${source.origin}/index.json`,
          source,
          fetcher,
          signal,
          0,
          { json: true, maxBytes: 12_000_000 },
        ),
      );
      if (!Array.isArray(data) || data.length > 30_000)
        throw new SourceError("unavailable");
      const items: CatalogItem[] = data
        .filter(
          (x) =>
            x &&
            x.kind === "title" &&
            typeof x.title === "string" &&
            /^\d{4}$/.test(String(x.year)) &&
            safeDirectUrl(x.url, "ifilm"),
        )
        .map((x) => ({
          title: x.title,
          original: typeof x.original === "string" ? x.original : undefined,
          year: String(x.year),
          url: safeDirectUrl(x.url, "ifilm")!,
        }));
      if (data.length && !items.length) throw new SourceError("unavailable");
      cached = { items, expires: Date.now() + 3_600_000 };
      return items;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}
type Candidate = { url: string; hasPlayer?: boolean };
async function nechegoCandidates(
  source: Source,
  target: Target,
  name: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Candidate[]> {
  const data: unknown = JSON.parse(
    await readResource(
      "https://api.nechego.pw/search/items",
      source,
      fetcher,
      signal,
      0,
      { json: true, body: JSON.stringify({ query: name }) },
    ),
  );
  if (!Array.isArray(data) || data.length > 1000)
    throw new SourceError("unavailable");
  const found: Candidate[] = [];
  for (const item of data) {
    if (
      !item ||
      typeof item.title !== "string" ||
      typeof item.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)
    )
      continue;
    const url = safeDirectUrl(`/${item.slug}`, source.id);
    const hasPlayer =
      Array.isArray(item.players) &&
      item.players.some(
        (p: any) =>
          p &&
          typeof p.type === "string" &&
          typeof p.url === "string" &&
          /^(?:https:\/\/|kp:\d+$)/.test(p.url),
      );
    if (
      url &&
      hasPlayer &&
      String(item.year) === target.year &&
      item.type === (target.type === "movie" ? "movie" : "series") &&
      titleMatches(item.title, target)
    )
      found.push({ url, hasPlayer });
  }
  return found.slice(0, 3);
}
function matchStructuredPage(
  html: string,
  candidate: Candidate,
  target: Target,
  source: Source,
): Pick<DirectSourceResult, "title" | "year" | "matchedBy"> | null {
  const $ = load(html);
  if (
    safeDirectUrl($('link[rel="canonical"]').attr("href"), source.id) !==
    candidate.url
  )
    return null;
  const metadata: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      metadata.push(
        ...(Array.isArray(data) ? data : [data]),
        ...(Array.isArray(data?.["@graph"]) ? data["@graph"] : []),
      );
    } catch {
      /* Malformed metadata is not evidence of a title match. */
    }
  });
  const item = metadata.find(
    (x) =>
      x &&
      x["@type"] === (target.type === "movie" ? "Movie" : "TVSeries") &&
      safeDirectUrl(x.url, source.id) === candidate.url &&
      String(x.datePublished).slice(0, 4) === target.year &&
      [x.name, x.alternateName].some(
        (n) => typeof n === "string" && titleMatches(n, target),
      ),
  );
  if (!item || typeof item.name !== "string") return null;
  const hasPlayer =
    source.id === "ifilm"
      ? $(
          "#player iframe[src], #player iframe[data-src], #player ins[data-publisher-id][data-id], #player [data-cvh-id]",
        )
          .toArray()
          .some((el) => {
            const e = $(el);
            return (
              [e.attr("src"), e.attr("data-src")].some((v) =>
                v?.startsWith("https://"),
              ) ||
              /^\d+$/.test(e.attr("data-id") ?? "") ||
              /^kp:\d+$/.test(e.attr("data-cvh-id") ?? "")
            );
          })
      : candidate.hasPlayer;
  return hasPlayer
    ? { title: item.name, year: target.year, matchedBy: "title_year" }
    : null;
}
function titleMatches(value: string, target: Target): boolean {
  return value
    .split(/\s+\/\s+/)
    .some((name) => target.names.some((t) => normalize(name) === normalize(t)));
}
function candidateUrls(html: string, source: Source, target: Target): string[] {
  const $ = load(html);
  if (!$("form.js-lightsearch-form").length || !$("#dle-content").length)
    throw new SourceError("unavailable");
  const found = new Set<string>();
  $(".shortstory__title a[href]").each((_, el) => {
    const url = safeDirectUrl($(el).attr("href"), source.id);
    const card = $(el).closest(".shortstory");
    const year = card
      .find('a[href*="/xfsearch/year-teg-xfsearch/"]')
      .first()
      .text()
      .trim();
    if (url && year === target.year && titleMatches($(el).text(), target))
      found.add(url);
  });
  return [...found].slice(0, 3);
}
function matchPage(
  html: string,
  url: string,
  target: Target,
  source: Source,
): Pick<DirectSourceResult, "title" | "year" | "matchedBy"> | null {
  const $ = load(html);
  const title = $(".fullstory__title h1").text().trim();
  const canonical = safeDirectUrl(
    $('link[rel="canonical"]').attr("href"),
    source.id,
  );
  const year = $('.m_info a[href*="/xfsearch/year-teg-xfsearch/"]')
    .first()
    .text()
    .trim();
  const categories = $(".m_info a")
    .map((_, e) => {
      try {
        return new URL($(e).attr("href")!, source.origin!).pathname;
      } catch {
        return "";
      }
    })
    .get();
  const isSeries =
    categories.some((c) =>
      ["/serialy/", "/multserialy/", "/doramy/"].includes(c),
    ) || /\d+(?:-\d+)?\s*сезон/.test(title);
  if (
    canonical !== url ||
    year !== target.year ||
    !titleMatches(title, target) ||
    isSeries !== (target.type === "tv")
  )
    return null;
  if (
    !$(".video-container iframe[data-src], .video-container iframe[src]").length
  )
    return null;
  return { title, year, matchedBy: "title_year" };
}
async function findSource(
  source: Source,
  target: Target,
  fetcher: typeof fetch,
  catalog: ReturnType<typeof createIfilmCatalog>,
): Promise<DirectSourceResult> {
  const base = {
    sourceId: source.id,
    checkedAt: new Date().toISOString(),
    url: null,
  };
  if (!source.origin) return { ...base, status: "needs_source" };
  if (!target.year || !target.names.length)
    return { ...base, status: "not_found" };
  try {
    const signal = AbortSignal.timeout(25_000);
    if (source.id === "ifilm") {
      const items = await catalog(signal);
      const candidates = items
        .filter(
          (x) =>
            x.year === target.year &&
            [x.title, x.original].some((n) => n && titleMatches(n, target)),
        )
        .slice(0, 3);
      for (const candidate of candidates) {
        const detail = await readHtml(candidate.url, source, fetcher, signal);
        const match = matchStructuredPage(detail, candidate, target, source);
        if (match)
          return { ...base, status: "found", url: candidate.url, ...match };
      }
      return { ...base, status: "not_found" };
    }
    for (const name of target.names.slice(0, 2)) {
      if (source.id === "nechego") {
        for (const candidate of await nechegoCandidates(
          source,
          target,
          name,
          fetcher,
          signal,
        )) {
          const detail = await readHtml(candidate.url, source, fetcher, signal);
          const match = matchStructuredPage(detail, candidate, target, source);
          if (match)
            return { ...base, status: "found", url: candidate.url, ...match };
        }
        continue;
      }
      const search = new URL(
        `/search/${encodeURIComponent(name)}`,
        source.origin,
      );
      const html = await readHtml(search.href, source, fetcher, signal);
      for (const url of candidateUrls(html, source, target)) {
        const detail = await readHtml(url, source, fetcher, signal);
        const match = matchPage(detail, url, target, source);
        if (match) return { ...base, status: "found", url, ...match };
      }
    }
    return { ...base, status: "not_found" };
  } catch (error) {
    return {
      ...base,
      status: error instanceof SourceError ? error.status : "unavailable",
    };
  }
}
export function createDirectFinder(fetcher: typeof fetch = fetch) {
  const catalog = createIfilmCatalog(fetcher);
  const cache = new Map<
    string,
    { expires: number; value: DirectLinksResult }
  >();
  const pending = new Map<string, Promise<DirectLinksResult>>();
  return async (target: Target): Promise<DirectLinksResult> => {
    const key = JSON.stringify(target);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(key)) return pending.get(key)!;
    const task = (async () => {
      const value = {
        titleId: target.id,
        mediaType: target.type,
        sources: await Promise.all(
          directSources.map((s) => findSource(s, target, fetcher, catalog)),
        ),
      };
      if (
        value.sources.every(
          (s) =>
            s.status === "found" ||
            s.status === "not_found" ||
            s.status === "needs_source",
        )
      ) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 600_000, value });
      }
      return value;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  };
}
export function registerDirectRoutes(
  app: FastifyInstance,
  tmdb: ReturnType<typeof createTmdb>,
  fetcher?: typeof fetch,
) {
  const find = createDirectFinder(fetcher);
  app.get<{ Params: { type: "movie" | "tv"; id: number } }>(
    "/api/direct-links/:type/:id",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["type", "id"],
          properties: {
            type: { type: "string", enum: ["movie", "tv"] },
            id: { type: "integer", minimum: 1, maximum: 2147483647 },
          },
        },
      },
    },
    async ({ params }) => {
      // Obtain trusted metadata server-side; callers cannot choose remote hosts or search strings.
      const title = await tmdb.get(`/${params.type}/${params.id}`, {
        language: "ru-RU",
      });
      if (title.adult)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Фильм недоступен в этом каталоге.",
        );
      if (title.id !== params.id)
        throw new ApiError(
          502,
          "TMDB_INVALID_RESPONSE",
          "Не удалось определить фильм.",
        );
      const names = [
        ...new Set(
          [title.title, title.name, title.original_title, title.original_name]
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim()),
        ),
      ];
      const date =
        params.type === "movie" ? title.release_date : title.first_air_date;
      const year =
        typeof date === "string" && /^\d{4}/.test(date) ? date.slice(0, 4) : "";
      return find({
        id: params.id,
        type: params.type,
        names,
        year,
      });
    },
  );
}
