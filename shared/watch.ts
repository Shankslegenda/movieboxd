export const categories = ["free", "ads", "flatrate", "rent", "buy"] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, string> = {
  free: "Бесплатно",
  ads: "Бесплатно с рекламой",
  flatrate: "По подписке",
  rent: "Аренда",
  buy: "Покупка",
};
export type WatchRegion = { code: string; name: string; supported: boolean };
export type WatchProvider = {
  id: number;
  name: string;
  logoPath: string | null;
  category: Category;
  region: string;
  link: string | null;
  linkType: "regional_availability" | "unavailable";
  source: "TMDB / JustWatch";
  verification: "reported_by_source";
  audio: { status: "unknown"; languages: string[] };
  subtitles: { status: "unknown"; languages: string[] };
};
export type WatchResult = {
  titleId: number;
  mediaType: "movie" | "tv";
  region: string;
  regionSupported: boolean;
  providers: WatchProvider[];
  availabilityLink: string | null;
  source: "TMDB / JustWatch";
  hasFree: boolean;
  hasAds: boolean;
};
// Only accept the exact title availability page supplied by TMDB. Never build provider URLs.
export function safeAvailabilityLink(
  value: unknown,
  type: string,
  id: number,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["www.themoviedb.org", "themoviedb.org"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (!new RegExp(`^/${type}/${id}(?:-[^/]*)?/watch/?$`).test(url.pathname))
      return null;
    return url.href;
  } catch {
    return null;
  }
}
