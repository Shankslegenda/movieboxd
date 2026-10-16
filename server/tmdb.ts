import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class ApiError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
export type TmdbOptions = {
  token?: string;
  apiKey?: string;
  database?: string;
  fetcher?: typeof fetch;
};
export function createTmdb({
  token,
  apiKey,
  database = ":memory:",
  fetcher = fetch,
}: TmdbOptions) {
  if (database !== ":memory:")
    mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(
    "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL)",
  );
  db.prepare("DELETE FROM cache WHERE expires < ?").run(Date.now());
  const pending = new Map<string, Promise<any>>();
  const configured = Boolean(token?.trim() || apiKey?.trim());
  async function get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<any> {
    if (!configured)
      throw new ApiError(
        503,
        "TMDB_NOT_CONFIGURED",
        "Добавьте TMDB_READ_ACCESS_TOKEN в .env и перезапустите сервер.",
      );
    const url = new URL(`https://api.themoviedb.org/3${path}`);
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );
    const key = url.pathname + url.search;
    const cached = db
      .prepare("SELECT body FROM cache WHERE key = ? AND expires > ?")
      .get(key, Date.now());
    if (cached) return JSON.parse(cached.body as string);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      if (apiKey && !token) url.searchParams.set("api_key", apiKey.trim());
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token.trim()}` } : {}),
          },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new ApiError(
          502,
          "TMDB_UNREACHABLE",
          "Не удалось связаться с TMDB. Попробуйте ещё раз.",
        );
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new ApiError(
            503,
            "TMDB_AUTH_ERROR",
            "TMDB отклонил ключ. Проверьте настройки сервера.",
          );
        if (response.status === 404)
          throw new ApiError(
            404,
            "NOT_FOUND",
            "Такой фильм или сериал не найден.",
          );
        if (response.status === 429)
          throw new ApiError(
            429,
            "TMDB_RATE_LIMIT",
            "Слишком много запросов. Повторите чуть позже.",
          );
        throw new ApiError(
          502,
          "TMDB_ERROR",
          "TMDB временно недоступен. Попробуйте позже.",
        );
      }
      let body: any;
      try {
        body = await response.json();
      } catch {
        throw new ApiError(
          502,
          "TMDB_INVALID_RESPONSE",
          "TMDB вернул некорректный ответ.",
        );
      }
      db.prepare("DELETE FROM cache WHERE expires < ?").run(Date.now());
      db.prepare("INSERT OR REPLACE INTO cache VALUES (?, ?, ?)").run(
        key,
        JSON.stringify(body),
        Date.now() + 10 * 60 * 1000,
      );
      // Bound disk use even for many distinct searches.
      db.exec(
        "DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY expires DESC LIMIT -1 OFFSET 1000)",
      );
      return body;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }
  return { get, configured, close: () => db.close() };
}
