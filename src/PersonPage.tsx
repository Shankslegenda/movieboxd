import { useEffect, useState, type ComponentType } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Search, UserRound } from "lucide-react";
import { useApi } from "./api";
import {
  imageUrl,
  keyOf,
  titleOf,
  yearOf,
  type Media,
  type PersonDetails,
} from "./types";
import "./person.css";

export function PersonPhoto({
  path,
  name,
}: {
  path?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(path, "h632");
  return src && !failed ? (
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div
      className="person-photo-fallback"
      role="img"
      aria-label={`Нет фотографии: ${name}`}
    >
      <UserRound aria-hidden="true" />
    </div>
  );
}
function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
export default function PersonPage({
  Card,
}: {
  Card: ComponentType<{ movie: Media }>;
}) {
  const { id } = useParams();
  return <PersonContent key={id} id={id || ""} Card={Card} />;
}
function PersonContent({
  id,
  Card,
}: {
  id: string;
  Card: ComponentType<{ movie: Media }>;
}) {
  const valid = /^\d+$/.test(id) && Number(id) > 0 && Number(id) <= 2147483647;
  const { data, loading, error, retry } = useApi<PersonDetails>(
    valid ? `/api/person/${id}` : null,
  );
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [role, setRole] = useState("all");
  const [sort, setSort] = useState("popular");
  const [limit, setLimit] = useState(24);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (data) document.title = `${data.name} — movieboxd`;
  }, [data]);
  useEffect(() => setLimit(24), [query, type, role, sort]);
  const projects = (data?.projects || [])
    .filter(
      (p) =>
        (type === "all" || p.media_type === type) &&
        (role === "all" || (role === "cast" ? p.asCast : p.asCrew)) &&
        [
          titleOf(p),
          p.original_title,
          p.original_name,
          ...p.characters,
          ...p.jobs,
        ].some((v) =>
          v?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
    )
    .sort((a, b) =>
      sort === "year"
        ? (yearOf(b) || "0").localeCompare(yearOf(a) || "0") ||
          b.popularity - a.popularity
        : b.popularity - a.popularity || a.id - b.id,
    );
  return (
    <div className="page-content person-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> На главную
      </Link>
      {loading ? (
        <div className="person-status" role="status">
          Загружаем профиль и проекты…
        </div>
      ) : error ? (
        <div className="person-status" role="alert">
          <h1>Не удалось загрузить профиль</h1>
          <p>{error.message}</p>
          <button className="button secondary" onClick={retry}>
            Попробовать снова
          </button>
        </div>
      ) : !data ? (
        <div className="person-status">
          <h1>Профиль не найден</h1>
          <p>Выберите актёра в карточке фильма.</p>
        </div>
      ) : (
        <>
          <section className="person-intro" aria-label="Профиль">
            <div className="person-portrait">
              <PersonPhoto path={data.profile_path} name={data.name} />
            </div>
            <div className="person-copy">
              <span className="eyebrow">ЛЮДИ В КИНО</span>
              <h1>{data.name}</h1>
              <p className="person-project-count">
                Проектов в TMDB: {data.projects.length}
              </p>
              <dl className="person-facts">
                {data.birthday && (
                  <div>
                    <dt>Дата рождения</dt>
                    <dd>{dateLabel(data.birthday)}</dd>
                  </div>
                )}
                {data.place_of_birth && (
                  <div>
                    <dt>Место рождения</dt>
                    <dd>{data.place_of_birth}</dd>
                  </div>
                )}
                {data.deathday && (
                  <div>
                    <dt>Дата смерти</dt>
                    <dd>{dateLabel(data.deathday)}</dd>
                  </div>
                )}
              </dl>
              <h2>Биография</h2>
              {data.biographyLanguage === "en-US" && data.biography && (
                <p className="biography-language">
                  На английском — русский перевод в TMDB отсутствует.
                </p>
              )}
              <p className={`person-biography ${expanded ? "expanded" : ""}`}>
                {data.biography || "Биография пока не добавлена в TMDB."}
              </p>
              {data.biography.length > 400 && (
                <button
                  className="person-text-button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? "Свернуть" : "Читать полностью"}
                </button>
              )}
            </div>
          </section>
          <section
            className="person-filmography"
            aria-labelledby="filmography-heading"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">НА ЭКРАНЕ И ЗА КАДРОМ</span>
                <h2 id="filmography-heading">
                  Фильмография <span className="red-dot" />
                </h2>
                <p>
                  Фильмы и сериалы, включая гостевые появления и работу над
                  проектами.
                </p>
              </div>
            </div>
            <div className="person-filters">
              <label className="person-project-search">
                <span>Поиск по проектам</span>
                <div>
                  <Search size={17} />
                  <input
                    type="search"
                    placeholder="Название или роль…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </label>
              <label>
                Тип проекта
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="all">Все проекты</option>
                  <option value="movie">Фильмы</option>
                  <option value="tv">Сериалы</option>
                </select>
              </label>
              <label>
                Участие
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="all">Все работы</option>
                  <option value="cast">В кадре</option>
                  <option value="crew">За кадром</option>
                </select>
              </label>
              <label>
                Порядок
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="popular">По популярности</option>
                  <option value="year">Сначала новые</option>
                </select>
              </label>
            </div>
            <p className="person-results" role="status">
              Найдено проектов: {projects.length}
            </p>
            {projects.length ? (
              <>
                <div className="movie-grid person-projects">
                  {projects.slice(0, limit).map((p) => (
                    <div key={keyOf(p)}>
                      <Card movie={p} />
                      <p className="project-role">
                        {p.characters.length
                          ? p.characters.join(" · ")
                          : p.asCast
                            ? "Участие в кадре"
                            : ""}
                        {p.asCast && p.jobs.length > 0 ? " · " : ""}
                        {p.jobs.join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
                {limit < projects.length && (
                  <button
                    className="button secondary person-load-more"
                    onClick={() => setLimit((n) => n + 24)}
                  >
                    Показать ещё ({projects.length - limit})
                  </button>
                )}
              </>
            ) : (
              <div className="person-status">
                <h3>Проекты не найдены</h3>
                <p>
                  {data.projects.length
                    ? "Измените запрос или фильтры."
                    : "В TMDB пока нет проектов этого человека."}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
