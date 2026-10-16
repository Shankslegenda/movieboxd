import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError, createTmdb, type TmdbOptions } from "./tmdb.ts";

import { registerDirectRoutes } from "./direct-links.ts";
import { registerPeopleRoutes } from "./people.ts";
import { registerWatchRoutes } from "./watch.ts";

const collections = {
  trending: { path: "/trending/movie/day", type: "movie" },
  popular: { path: "/movie/popular", type: "movie" },
  top: { path: "/movie/top_rated", type: "movie" },
  new: { path: "/movie/now_playing", type: "movie" },
  tv: { path: "/tv/popular", type: "tv" },
  anime: { path: "/discover/tv", type: "tv" },
} as const;
export function buildApp(
  options: TmdbOptions & { directFetcher?: typeof fetch; trustHostingProxy?: boolean } = {},
) {
  const app = Fastify({
    logger: false,
    trustProxy: options.trustHostingProxy ? ["loopback", "linklocal", "uniquelocal"] : false,
  });
  const tmdb = createTmdb(options);
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("onClose", async () => tmdb.close());
  app.setErrorHandler((error: any, _request, reply) => {
    if (error instanceof ApiError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    if (error.validation)
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "Проверьте параметры запроса.",
      });
    if (error.statusCode === 429)
      return reply.code(429).send({
        code: "RATE_LIMIT",
        message: "Слишком много запросов. Повторите позже.",
      });
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "Ошибка сервера. Попробуйте позже.",
    });
  });
  // Register routes after rate-limit installs its onRoute hook.
  app.after(() => {
    const common = {
      language: { type: "string", enum: ["ru-RU", "en-US"], default: "ru-RU" },
      page: { type: "integer", minimum: 1, maximum: 500, default: 1 },
    };
    const clean = (data: any, type?: string) => ({
      ...data,
      results: (data.results ?? [])
        .filter(
          (m: any) =>
            !m.adult &&
            (type || m.media_type === "movie" || m.media_type === "tv"),
        )
        .map((m: any) => ({ ...m, media_type: type ?? m.media_type })),
    });
    app.get("/api/health", { config: { rateLimit: false } }, async () => ({
      ok: true,
      tmdbConfigured: tmdb.configured,
    }));
    app.get<{ Querystring: { language: string } }>(
      "/api/home",
      {
        schema: {
          querystring: {
            type: "object",
            properties: { language: common.language },
          },
        },
      },
      async (request) => {
        const sections = await Promise.all(
          Object.entries(collections).map(async ([id, collection]) => {
            try {
              const data = await tmdb.get(collection.path, {
                language: request.query.language,
                ...(id === "anime"
                  ? {
                      with_genres: 16,
                      with_original_language: "ja",
                      include_adult: "false",
                    }
                  : {}),
              });
              return { id, ...clean(data, collection.type) };
            } catch (error) {
              if (
                error instanceof ApiError &&
                ["TMDB_NOT_CONFIGURED", "TMDB_AUTH_ERROR"].includes(error.code)
              )
                throw error;
              return { id, results: [], error: "Подборка временно недоступна" };
            }
          }),
        );
        if (sections.every((s) => s.error))
          throw new ApiError(
            502,
            "TMDB_UNREACHABLE",
            "Не удалось загрузить подборки TMDB. Попробуйте ещё раз.",
          );
        return { sections };
      },
    );
    app.get<{
      Querystring: {
        query: string;
        page: number;
        language: string;
        type: string;
      };
    }>(
      "/api/search",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["query"],
            properties: {
              ...common,
              query: { type: "string", minLength: 1, maxLength: 200 },
              type: {
                type: "string",
                enum: ["all", "movie", "tv"],
                default: "all",
              },
            },
          },
        },
      },
      async ({ query }) => {
        if (!query.query.trim())
          throw new ApiError(
            400,
            "EMPTY_QUERY",
            "Введите название фильма или сериала.",
          );
        const data = await tmdb.get(
          `/search/${query.type === "all" ? "multi" : query.type}`,
          {
            query: query.query.trim(),
            page: query.page,
            language: query.language,
            include_adult: "false",
          },
        );
        return clean(data, query.type === "all" ? undefined : query.type);
      },
    );
    app.get<{
      Params: { collection: keyof typeof collections };
      Querystring: { language: string; page: number };
    }>(
      "/api/catalog/:collection",
      {
        schema: {
          params: {
            type: "object",
            properties: {
              collection: { type: "string", enum: Object.keys(collections) },
            },
            required: ["collection"],
          },
          querystring: { type: "object", properties: common },
        },
      },
      async ({ params, query }) => {
        const collection = collections[params.collection];
        return clean(
          await tmdb.get(collection.path, {
            ...query,
            ...(params.collection === "anime"
              ? {
                  with_genres: 16,
                  with_original_language: "ja",
                  include_adult: "false",
                }
              : {}),
          }),
          collection.type,
        );
      },
    );
    app.get<{
      Params: { type: "movie" | "tv"; id: number };
      Querystring: { language: string };
    }>(
      "/api/title/:type/:id",
      {
        schema: {
          params: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["movie", "tv"] },
              id: { type: "integer", minimum: 1 },
            },
            required: ["type", "id"],
          },
          querystring: {
            type: "object",
            properties: { language: common.language },
          },
        },
      },
      async ({ params, query }) => {
        const data = await tmdb.get(`/${params.type}/${params.id}`, {
          language: query.language,
          append_to_response: "credits,videos,recommendations",
        });
        if (data.adult)
          throw new ApiError(
            404,
            "NOT_FOUND",
            "Фильм недоступен в этом каталоге.",
          );
        return {
          ...data,
          media_type: params.type,
          recommendations: clean(data.recommendations ?? {}, params.type),
        };
      },
    );
    registerWatchRoutes(app, tmdb);
    registerDirectRoutes(app, tmdb, options.directFetcher);
    registerPeopleRoutes(app, tmdb);
    const dist = resolve(import.meta.dirname, "../dist");
    if (existsSync(dist)) {
      app.register(fastifyStatic, { root: dist });
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api/")
          ? reply
              .code(404)
              .send({ code: "NOT_FOUND", message: "Маршрут не найден." })
          : reply.sendFile("index.html"),
      );
    }
  });
  return app;
}
