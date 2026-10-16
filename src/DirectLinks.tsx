import { ExternalLink, Globe2, LoaderCircle } from "lucide-react";
import { useApi } from "./api";
import { titleOf, type Media } from "./types";
import {
  directSources,
  safeDirectUrl,
  type DirectLinksResult,
} from "../shared/direct-links";

export default function DirectLinks({ movie }: { movie: Media }) {
  const { data, loading, error, retry } = useApi<DirectLinksResult>(
    `/api/direct-links/${movie.media_type}/${movie.id}`,
  );
  return (
    <section
      className="external-watch-search"
      aria-label="Прямые ссылки на фильм"
    >
      <div className="external-search-heading">
        <Globe2 size={18} />
        <div>
          <h3>Открыть на сайте</h3>
          <span>Автоматический поиск прямых ссылок</span>
        </div>
      </div>
      <p>
        Находим страницу по названию, году и типу проекта. Ссылка ведёт прямо к
        фильму или сериалу на выбранном сайте.
      </p>
      {loading && (
        <p className="direct-loading" role="status">
          <LoaderCircle className="spin" size={16} /> Проверяем сайты… Это может
          занять до 40 секунд при первом открытии.
        </p>
      )}
      {error && (
        <div className="direct-error" role="alert">
          <p>{error.message}</p>
          <button onClick={retry}>Повторить поиск на сайтах</button>
        </div>
      )}
      {data && (
        <div className="external-search-grid">
          {directSources
            .filter((source) => source.origin)
            .map((source) => {
              const result = data.sources.find((r) => r.sourceId === source.id);
              const href =
                result?.status === "found"
                  ? safeDirectUrl(result.url, source.id)
                  : null;
              return (
                <div className="direct-source" key={source.id}>
                  <div className="direct-source-heading">
                    <strong>{source.name}</strong>
                    <span>
                      {source.origin
                        ? new URL(source.origin).hostname
                        : "Ожидает подключения"}
                    </span>
                  </div>
                  {href ? (
                    <>
                      <p>{result?.title}</p>
                      <span className="direct-match">
                        Совпадение по названию и году
                      </span>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Открыть ${titleOf(movie)} на ${source.name}`}
                      >
                        {movie.media_type === "tv"
                          ? "Открыть сериал"
                          : "Открыть фильм"}{" "}
                        <ExternalLink size={14} />
                      </a>
                    </>
                  ) : (
                    <p className="direct-status">
                      {result?.status === "needs_source"
                        ? "Нужен рабочий адрес HDRezka. Непроверенные зеркала отключены."
                        : result?.status === "not_found"
                          ? "Точное совпадение не найдено."
                          : result?.status === "blocked"
                            ? "Сайт ограничил автоматический доступ. Попробуйте позже."
                            : "Не удалось проверить сайт. Попробуйте ещё раз."}
                    </p>
                  )}
                </div>
              );
            })}
        </div>
      )}
      {data?.sources.some(
        (s) => s.status === "unavailable" || s.status === "blocked",
      ) && (
        <button className="direct-retry" onClick={retry}>
          Повторить поиск на сайтах
        </button>
      )}
      <p className="direct-note">
        Проверяем страницу и наличие блока плеера. Воспроизведение и доступность
        в вашей стране не проверены. Результаты кешируются до 10 минут.
      </p>
    </section>
  );
}
