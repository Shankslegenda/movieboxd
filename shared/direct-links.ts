export const directSources = [
  { id: "kinogo", name: "Kinogo", origin: "https://kinogo2026.com" },
  { id: "ifilm", name: "iFilm", origin: "https://ifilm.space" },
  { id: "nechego", name: "Нечего смотреть", origin: "https://nechego.pw" },
  { id: "hdrezka", name: "HDRezka", origin: null },
] as const;
export type DirectSourceId = (typeof directSources)[number]["id"];
export type DirectSourceResult = {
  sourceId: DirectSourceId;
  status: "found" | "not_found" | "unavailable" | "blocked" | "needs_source";
  checkedAt: string;
  url: string | null;
  title?: string;
  year?: string;
  matchedBy?: "title_year";
};
export type DirectLinksResult = {
  titleId: number;
  mediaType: "movie" | "tv";
  sources: DirectSourceResult[];
};
// Domains are explicit. The API cannot be used to fetch arbitrary URLs or mirrors.
export function safeDirectUrl(value: unknown, sourceId: string): string | null {
  const source = directSources.find((s) => s.id === sourceId);
  if (!source?.origin || typeof value !== "string") return null;
  try {
    const url = new URL(value, source.origin);
    if (
      url.origin !== source.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        source.id === "kinogo"
          ? /^\/[1-9]\d*-[a-z0-9-]+\.html$/
          : source.id === "ifilm"
            ? /^\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/
            : /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/
      ).test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
