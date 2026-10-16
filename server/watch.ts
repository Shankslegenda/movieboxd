import type { FastifyInstance } from "fastify";
import { ApiError, type createTmdb } from "./tmdb.ts";
import {
  categories,
  safeAvailabilityLink,
  type WatchResult,
  type WatchProvider,
  type WatchRegion,
} from "../shared/watch.ts";

type Client = ReturnType<typeof createTmdb>;
const primaryRegions: Record<string, string> = {
  KZ: "Казахстан",
  US: "США",
  GB: "Великобритания",
  DE: "Германия",
  CA: "Канада",
};
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function invalidResponse(): never {
  throw new ApiError(
    502,
    "TMDB_INVALID_RESPONSE",
    "TMDB вернул некорректные данные о просмотре. Попробуйте позже.",
  );
}

export interface WatchIntegration {
  regions(): Promise<WatchRegion[]>;
  find(
    type: "movie" | "tv",
    id: number,
    region: WatchRegion,
  ): Promise<WatchResult>;
}
export function tmdbWatchIntegration(client: Client): WatchIntegration {
  return {
    async regions() {
      const data = await client.get("/watch/providers/regions", {
        language: "ru-RU",
      });
      if (!record(data) || !Array.isArray(data.results) || !data.results.length)
        invalidResponse();
      const names = new Intl.DisplayNames(["ru"], { type: "region" });
      const regions = new Map<string, WatchRegion>();
      for (const item of data.results) {
        if (
          !record(item) ||
          typeof item.iso_3166_1 !== "string" ||
          !/^[A-Z]{2}$/.test(item.iso_3166_1)
        )
          continue;
        const code = item.iso_3166_1;
        regions.set(code, {
          code,
          name:
            primaryRegions[code] || names.of(code) || item.native_name || code,
          supported: true,
        });
      }
      if (!regions.size) invalidResponse();
      // KZ remains selectable even when TMDB has no watch-provider coverage there.
      for (const [code, name] of Object.entries(primaryRegions))
        if (!regions.has(code))
          regions.set(code, { code, name, supported: false });
      const order = Object.keys(primaryRegions);
      return [...regions.values()].sort((a, b) => {
        const ai = order.indexOf(a.code);
        const bi = order.indexOf(b.code);
        return (
          (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
          a.name.localeCompare(b.name, "ru")
        );
      });
    },
    async find(type, id, region) {
      const data = await client.get(`/${type}/${id}/watch/providers`);
      if (!record(data) || data.id !== id || !record(data.results))
        invalidResponse();
      const regional = data.results[region.code];
      if (regional !== undefined && !record(regional)) invalidResponse();
      const link = safeAvailabilityLink(regional?.link, type, id);
      const providers: WatchProvider[] = [];
      for (const category of categories) {
        const items = regional?.[category];
        if (items !== undefined && !Array.isArray(items)) invalidResponse();
        const seen = new Set<number>();
        for (const p of items || []) {
          if (
            !record(p) ||
            !Number.isSafeInteger(p.provider_id) ||
            p.provider_id <= 0 ||
            typeof p.provider_name !== "string" ||
            !p.provider_name.trim()
          )
            invalidResponse();
          if (seen.has(p.provider_id)) continue;
          seen.add(p.provider_id);
          providers.push({
            id: p.provider_id,
            name: p.provider_name,
            logoPath:
              typeof p.logo_path === "string" && /^\/[\w.-]+$/.test(p.logo_path)
                ? p.logo_path
                : null,
            category,
            region: region.code,
            link,
            linkType: link ? "regional_availability" : "unavailable",
            source: "TMDB / JustWatch",
            verification: "reported_by_source",
            audio: { status: "unknown", languages: [] },
            subtitles: { status: "unknown", languages: [] },
          });
        }
      }
      return {
        titleId: id,
        mediaType: type,
        region: region.code,
        regionSupported: region.supported || !!regional,
        providers,
        availabilityLink: link,
        source: "TMDB / JustWatch",
        hasFree: providers.some((p) => p.category === "free"),
        hasAds: providers.some((p) => p.category === "ads"),
      };
    },
  };
}
export function registerWatchRoutes(app: FastifyInstance, client: Client) {
  const integration = tmdbWatchIntegration(client);
  app.get("/api/watch/regions", async () => ({
    regions: await integration.regions(),
  }));
  app.get<{
    Params: { type: "movie" | "tv"; id: number };
    Querystring: { region: string };
  }>(
    "/api/watch/:type/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["type", "id"],
          properties: {
            type: { type: "string", enum: ["movie", "tv"] },
            id: { type: "integer", minimum: 1, maximum: 2147483647 },
          },
        },
        querystring: {
          type: "object",
          properties: {
            region: { type: "string", pattern: "^[A-Z]{2}$", default: "KZ" },
          },
        },
      },
    },
    async ({ params, query }) => {
      const regions = await integration.regions();
      const region = regions.find((r) => r.code === query.region);
      if (!region)
        throw new ApiError(
          400,
          "INVALID_REGION",
          "Выберите страну из списка поддерживаемых регионов.",
        );
      return integration.find(params.type, params.id, region);
    },
  );
}
