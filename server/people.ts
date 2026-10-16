import type { FastifyInstance } from "fastify";
import { ApiError, type createTmdb } from "./tmdb.ts";

type Client = ReturnType<typeof createTmdb>;
export function registerPeopleRoutes(app: FastifyInstance, tmdb: Client) {
  app.get<{ Params: { id: number }; Querystring: { language: string } }>(
    "/api/person/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "integer", minimum: 1, maximum: 2147483647 },
          },
        },
        querystring: {
          type: "object",
          properties: {
            language: {
              type: "string",
              enum: ["ru-RU", "en-US"],
              default: "ru-RU",
            },
          },
        },
      },
    },
    async ({ params, query }) => {
      const person = await tmdb.get(`/person/${params.id}`, {
        language: query.language,
        append_to_response: "combined_credits",
      });
      if (
        !person ||
        person.id !== params.id ||
        typeof person.name !== "string" ||
        !Array.isArray(person.combined_credits?.cast) ||
        !Array.isArray(person.combined_credits?.crew)
      ) {
        throw new ApiError(
          502,
          "TMDB_INVALID_RESPONSE",
          "TMDB вернул некорректный профиль. Попробуйте позже.",
        );
      }
      if (person.adult)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Этот профиль недоступен в каталоге.",
        );
      let biography =
        typeof person.biography === "string" ? person.biography : "";
      let biographyLanguage = query.language;
      if (!biography.trim() && query.language === "ru-RU") {
        try {
          const english = await tmdb.get(`/person/${params.id}`, {
            language: "en-US",
          });
          if (
            typeof english.biography === "string" &&
            english.biography.trim()
          ) {
            biography = english.biography;
            biographyLanguage = "en-US";
          }
        } catch {
          /* Filmography remains usable if the optional translation is unavailable. */
        }
      }
      const projects = new Map<string, any>();
      for (const kind of ["cast", "crew"] as const) {
        for (const credit of person.combined_credits[kind]) {
          if (
            !credit ||
            credit.adult ||
            !["movie", "tv"].includes(credit.media_type) ||
            !Number.isSafeInteger(credit.id) ||
            credit.id <= 0
          )
            continue;
          const key = `${credit.media_type}/${credit.id}`;
          const item = projects.get(key) || {
            id: credit.id,
            media_type: credit.media_type,
            title: credit.title,
            name: credit.name,
            original_title: credit.original_title,
            original_name: credit.original_name,
            overview:
              typeof credit.overview === "string" ? credit.overview : "",
            poster_path: credit.poster_path || null,
            backdrop_path: credit.backdrop_path || null,
            vote_average: Number.isFinite(credit.vote_average)
              ? credit.vote_average
              : 0,
            release_date: credit.release_date,
            first_air_date: credit.first_air_date,
            popularity: Number.isFinite(credit.popularity)
              ? credit.popularity
              : 0,
            characters: [],
            jobs: [],
            asCast: false,
            asCrew: false,
          };
          if (kind === "cast") {
            item.asCast = true;
            if (
              typeof credit.character === "string" &&
              credit.character.trim() &&
              !item.characters.includes(credit.character)
            )
              item.characters.push(credit.character);
          } else {
            item.asCrew = true;
            if (
              typeof credit.job === "string" &&
              credit.job.trim() &&
              !item.jobs.includes(credit.job)
            )
              item.jobs.push(credit.job);
          }
          projects.set(key, item);
        }
      }
      return {
        id: person.id,
        name: person.name,
        profile_path: person.profile_path || null,
        biography,
        biographyLanguage,
        birthday: person.birthday || null,
        deathday: person.deathday || null,
        place_of_birth: person.place_of_birth || null,
        known_for_department: person.known_for_department || null,
        also_known_as: person.also_known_as || [],
        projects: [...projects.values()].sort(
          (a, b) => b.popularity - a.popularity || a.id - b.id,
        ),
      };
    },
  );
}
