import WatchButton from "./WatchPanel";
import PersonPage, { PersonPhoto } from "./PersonPage";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  Film,
  Info,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useApi, type RequestError } from "./api";
import { useLibrary } from "./library";
import {
  imageUrl,
  keyOf,
  sections,
  titleOf,
  yearOf,
  type Details,
  type Media,
  type Results,
  type Section,
} from "./types";

function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const query = params.get("q") || "";
  const [input, setInput] = useState(query);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    setInput(query);
  }, [query, location.pathname]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function change(value: string) {
    setInput(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim())
        navigate(`/search?q=${encodeURIComponent(value.trim())}`, {
          replace: location.pathname === "/search",
        });
      else if (location.pathname === "/search") navigate("/");
    }, 350);
  }
  return (
    <header className="header">
      <Link to="/" className="wordmark" aria-label="movieboxd — главная">
        movieboxd<span>•</span>
      </Link>
      <nav aria-label="Главная навигация">
        <NavLink to="/" end>
          Главная
        </NavLink>
        <NavLink to="/catalog/popular">Фильмы</NavLink>
        <NavLink to="/catalog/tv">Сериалы</NavLink>
        <NavLink to="/catalog/anime">Аниме</NavLink>
      </nav>
      <div className="header-actions">
        <form
          className={`searchbox ${expanded ? "expanded" : ""}`}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            clearTimeout(timer.current);
            if (input.trim())
              navigate(`/search?q=${encodeURIComponent(input.trim())}`);
          }}
        >
          <Search size={17} />
          <input
            aria-label="Поиск фильмов и сериалов"
            placeholder="Фильм или сериал…"
            maxLength={200}
            value={input}
            onFocus={() => setExpanded(true)}
            onChange={(e) => change(e.target.value)}
          />
          {input && (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                change("");
                setExpanded(false);
              }}
            >
              <X size={15} />
            </button>
          )}
        </form>
        <Link
          to="/favorites"
          className="icon-button saved-link"
          aria-label="Моя коллекция"
        >
          <Bookmark size={20} />
        </Link>
        <span className="profile" title="Личная коллекция на этом устройстве">
          М
        </span>
      </div>
    </header>
  );
}
function Poster({ movie }: { movie: Media }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(movie.poster_path);
  return src && !failed ? (
    <img
      src={src}
      alt={`Постер: ${titleOf(movie)}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="poster-fallback">
      <Film size={36} />
      <span>{titleOf(movie)}</span>
    </div>
  );
}
function SaveButton({ movie, full = false }: { movie: Media; full?: boolean }) {
  const { saved, toggle } = useLibrary();
  const active = saved.some((m) => keyOf(m) === keyOf(movie));
  return (
    <button
      className={full ? "button secondary" : "save-button"}
      aria-label={`${active ? "Удалить из коллекции" : "В коллекцию"}: ${titleOf(movie)}`}
      aria-pressed={active}
      onClick={() => toggle(movie)}
    >
      {active ? <Check size={19} /> : <Plus size={19} />}{" "}
      {full && (active ? "В коллекции" : "В коллекцию")}
    </button>
  );
}
function Card({ movie }: { movie: Media }) {
  return (
    <article className="movie-card">
      <div className="poster-wrap">
        <Link
          to={`/title/${keyOf(movie)}`}
          className="poster-link"
          aria-label={`Подробнее: ${titleOf(movie)}`}
        >
          <Poster movie={movie} />
          <span className="poster-shade" />
        </Link>
        {movie.vote_average > 0 && (
          <span className="rating">
            <Star size={10} fill="currentColor" />
            {movie.vote_average.toFixed(1)}
          </span>
        )}
        <SaveButton movie={movie} />
        <span className="media-label">
          {movie.media_type === "tv" ? "СЕРИАЛ" : "ФИЛЬМ"}
        </span>
      </div>
      <Link className="card-title" to={`/title/${keyOf(movie)}`}>
        {titleOf(movie)}
      </Link>
      <p className="card-meta">
        {yearOf(movie) || "Дата не указана"}
        <span>•</span>
        {movie.media_type === "tv" ? "Сериал" : "Фильм"}
      </p>
    </article>
  );
}
function Rail({
  title,
  note,
  movies,
  to,
}: {
  title: string;
  note?: string;
  movies: Media[];
  to?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  if (!movies.length) return null;
  return (
    <section className="rail-section">
      <div className="section-heading">
        <div>
          <h2>
            {title}
            <span className="red-dot" />
          </h2>
          {note && <p>{note}</p>}
        </div>
        <div className="rail-controls">
          {to && (
            <Link to={to}>
              Смотреть все <ArrowRight size={15} />
            </Link>
          )}
          <button
            className="icon-button"
            aria-label={`Прокрутить назад: ${title}`}
            onClick={() =>
              ref.current?.scrollBy({
                left: -ref.current.clientWidth * 0.8,
                behavior: "smooth",
              })
            }
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="icon-button"
            aria-label={`Прокрутить вперёд: ${title}`}
            onClick={() =>
              ref.current?.scrollBy({
                left: ref.current.clientWidth * 0.8,
                behavior: "smooth",
              })
            }
          >
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <div className="movie-rail" ref={ref}>
        {movies.map((m) => (
          <Card movie={m} key={keyOf(m)} />
        ))}
      </div>
    </section>
  );
}
function ErrorPanel({
  error,
  retry,
}: {
  error: RequestError;
  retry: () => void;
}) {
  const setup = error.code === "TMDB_NOT_CONFIGURED";
  return (
    <section className="status-panel" role="alert">
      <div className="status-icon">{setup ? <Settings2 /> : <Info />}</div>
      <div>
        <span className="eyebrow">
          {setup ? "ОДИН ШАГ ДО ПЕРВОГО ФИЛЬМА" : "НЕ УДАЛОСЬ ЗАГРУЗИТЬ"}
        </span>
        <h2>
          {setup ? "Подключите свою киновселенную" : "Кажется, у нас антракт"}
        </h2>
        <p>
          {setup
            ? "Каталог, постеры и поиск загружаются напрямую из TMDB. Для первого запуска нужен ключ API."
            : error.message}
        </p>
        {setup && (
          <p className="setup-help">
            В папке movieboxd скопируйте <code>.env.example</code> в{" "}
            <code>.env</code>, добавьте <code>TMDB_READ_ACCESS_TOKEN</code> и
            перезапустите сервер.
          </p>
        )}
        <div className="status-actions">
          <button className="button secondary" onClick={retry}>
            Попробовать снова <ArrowRight size={16} />
          </button>
          {setup && (
            <a
              href="https://www.themoviedb.org/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              Получить ключ TMDB <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
function Loading({ hero = false }: { hero?: boolean }) {
  return (
    <div aria-label="Загрузка каталога" role="status" className="loading-area">
      {hero && <div className="skeleton skeleton-hero" />}
      <div className="loading-label">
        <LoaderCircle className="spin" size={17} /> Ищем хорошие истории…
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skeleton skeleton-poster" key={i} />
        ))}
      </div>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Clapperboard size={42} />
      <h2>{title}</h2>
      <p>{text}</p>
      <Link to="/" className="button secondary">
        Открыть главную <ArrowRight size={16} />
      </Link>
    </div>
  );
}
function Hero({ movies }: { movies: Media[] }) {
  const [index, setIndex] = useState(0);
  const movie = movies[index % Math.max(movies.length, 1)];
  const backdrop = imageUrl(movie?.backdrop_path, "original");
  return (
    <section
      className={`hero ${movie ? "" : "intro-hero"}`}
      style={backdrop ? { backgroundImage: `url("${backdrop}")` } : {}}
      aria-label="Фильм в центре внимания"
    >
      <div className="hero-vignette" />
      <div className="hero-content">
        <span className="eyebrow hero-eyebrow">
          <span className="live-dot" />
          {movie ? "СЕГОДНЯ В ЦЕНТРЕ ВНИМАНИЯ" : "МЕНЬШЕ ПОИСКОВ. БОЛЬШЕ КИНО."}
        </span>
        <h1>
          {movie ? (
            titleOf(movie)
          ) : (
            <>
              Следующая история.
              <br />
              Ваше открытие.
            </>
          )}
        </h1>
        {movie && (
          <div className="hero-meta">
            {movie.vote_average > 0 && (
              <span className="hero-score">
                <Star size={15} fill="currentColor" />
                {movie.vote_average.toFixed(1)} <small>TMDB</small>
              </span>
            )}
            <span>{yearOf(movie)}</span>
            <span>{movie.media_type === "tv" ? "Сериал" : "Фильм"}</span>
            <span className="quality">
              {movie.original_language?.toUpperCase() || "КИНО"}
            </span>
          </div>
        )}
        <p className="hero-description">
          {movie
            ? movie.overview ||
              "Откройте подробности и узнайте больше об этой истории."
            : "Большие премьеры, маленькие шедевры и то самое кино под настроение. Соберите свою коллекцию впечатлений."}
        </p>
        <div className="hero-buttons">
          {movie ? (
            <>
              <Link className="button primary" to={`/title/${keyOf(movie)}`}>
                <Info size={19} /> О фильме
              </Link>
              <SaveButton movie={movie} full />
            </>
          ) : (
            <a href="#discover" className="button primary">
              Начать открывать <ArrowDown size={18} />
            </a>
          )}
        </div>
      </div>
      <div className="hero-bottom">
        <span className="hero-caption">КИНО НАЧИНАЕТСЯ С ЛЮБОПЫТСТВА</span>
        {movies.length > 1 && (
          <div className="hero-pagination">
            <span>
              {String(index + 1).padStart(2, "0")}{" "}
              <small>/ {String(movies.length).padStart(2, "0")}</small>
            </span>
            {movies.map((m, i) => (
              <button
                key={keyOf(m)}
                className={i === index ? "active" : ""}
                onClick={() => setIndex(i)}
                aria-label={`Показать фильм: ${titleOf(m)}`}
                aria-pressed={i === index}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
function Home() {
  const { data, error, loading, retry } = useApi<{ sections: Section[] }>(
    "/api/home",
  );
  const { recent } = useLibrary();
  if (loading) return <Loading hero />;
  const featured = (
    data?.sections.find((s) => s.id === "trending")?.results || []
  )
    .filter((m) => m.backdrop_path)
    .slice(0, 5);
  return (
    <>
      <Hero movies={featured} />
      <div className="page-content" id="discover">
        <div className="discovery-bar">
          <div>
            <Sparkles size={18} />
            <span>Что посмотрим сегодня?</span>
          </div>
          <div className="category-chips">
            <Link className="active" to="/">
              Для вас
            </Link>
            <Link to="/catalog/trending">В тренде</Link>
            <Link to="/catalog/new">Новинки</Link>
            <Link to="/catalog/top">Лучшее</Link>
            <Link to="/favorites">
              <Bookmark size={14} /> Моя коллекция
            </Link>
          </div>
        </div>
        {error && <ErrorPanel error={error} retry={retry} />}
        <Rail
          title="Продолжайте открывать"
          note="Истории, которые вас заинтересовали"
          movies={recent.slice(0, 12)}
        />
        {data?.sections.map((section) =>
          section.error ? (
            <div className="section-error" key={section.id}>
              <h2>{sections[section.id].title}</h2>
              <p>{section.error}</p>
              <button className="text-button" onClick={retry}>
                Повторить загрузку
              </button>
            </div>
          ) : (
            <Rail
              key={section.id}
              title={sections[section.id].title}
              note={sections[section.id].note}
              movies={section.results}
              to={`/catalog/${section.id}`}
            />
          ),
        )}
        <div className="editorial-note">
          <span className="note-icon">
            <Clapperboard size={29} />
          </span>
          <div>
            <span className="eyebrow">ВАША ЛИЧНАЯ КИНОПОЛКА</span>
            <h2>Хорошее кино стоит сохранить.</h2>
            <p>
              Добавляйте находки в коллекцию — они останутся с вами на этом
              устройстве.
            </p>
          </div>
          <Link to="/favorites" className="button secondary">
            Моя коллекция <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    </>
  );
}
function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (n: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <nav className="pagination" aria-label="Страницы результатов">
      <button
        className="button secondary"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        <ChevronLeft size={17} /> Назад
      </button>
      <span>
        Страница {page} из {Math.min(total, 500)}
      </span>
      <button
        className="button secondary"
        disabled={page >= Math.min(total, 500)}
        onClick={() => setPage(page + 1)}
      >
        Далее <ChevronRight size={17} />
      </button>
    </nav>
  );
}
function Browse({ search = false }: { search?: boolean }) {
  const { collection = "popular" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const type = ["all", "movie", "tv"].includes(params.get("type") || "")
    ? params.get("type")!
    : "all";
  const page = Math.max(
    1,
    Math.min(500, Number.parseInt(params.get("page") || "1") || 1),
  );
  const known = search || !!sections[collection];
  const url =
    !known || (search && !q.trim())
      ? null
      : search
        ? `/api/search?query=${encodeURIComponent(q)}&page=${page}&type=${type}`
        : `/api/catalog/${collection}?page=${page}`;
  const { data, error, loading, retry } = useApi<Results>(url);
  const heading = search
    ? q
      ? `«${q}»`
      : "Найдите свою историю"
    : sections[collection]?.title || "Подборка не найдена";
  function setPage(n: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(n));
    setParams(next);
  }
  return (
    <div className="page-content browse-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> На главную
      </Link>
      <span className="eyebrow">
        {search ? "ПОИСК ПО TMDB" : "КАТАЛОГ MOVIEBOXD"}
      </span>
      <h1>{heading}</h1>
      <p className="page-subtitle">
        {search
          ? "Фильмы и сериалы для следующего вечера"
          : sections[collection]?.note}
      </p>
      {search && (
        <div className="category-chips search-filters">
          {[
            ["all", "Всё"],
            ["movie", "Фильмы"],
            ["tv", "Сериалы"],
          ].map(([value, name]) => (
            <button
              key={value}
              className={type === value ? "active" : ""}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("type", value);
                next.delete("page");
                setParams(next);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {loading && <Loading />}
      {error && <ErrorPanel error={error} retry={retry} />}
      <div aria-live="polite">
        {data && !data.results.length && (
          <Empty
            title="Пока ничего не нашлось"
            text="Попробуйте другое название или измените тип поиска."
          />
        )}
      </div>
      {data && data.results.length > 0 && (
        <>
          <div className="movie-grid">
            {data.results.map((m) => (
              <Card key={keyOf(m)} movie={m} />
            ))}
          </div>
        </>
      )}
      {data && (
        <Pagination page={page} total={data.total_pages} setPage={setPage} />
      )}
      {!url && (
        <Empty
          title={known ? "С чего начнём?" : "Такой подборки нет"}
          text="Введите название в поиске или вернитесь к подборкам на главной."
        />
      )}
    </div>
  );
}
function Favorites() {
  const { saved } = useLibrary();
  return (
    <div className="page-content browse-page">
      <span className="eyebrow">ВАША ЛИЧНАЯ КИНОПОЛКА</span>
      <h1>
        Моя коллекция<span className="count">{saved.length}</span>
      </h1>
      <p className="page-subtitle">
        То самое кино, к которому хочется вернуться.
      </p>
      {saved.length ? (
        <div className="movie-grid">
          {saved.map((m) => (
            <Card key={keyOf(m)} movie={m} />
          ))}
        </div>
      ) : (
        <Empty
          title="Здесь начинается ваша коллекция"
          text="Нажмите плюс на карточке фильма, чтобы сохранить его на этом устройстве."
        />
      )}
    </div>
  );
}
function TitlePage() {
  const { type, id } = useParams();
  const valid = (type === "movie" || type === "tv") && /^\d+$/.test(id || "");
  const { data, error, loading, retry } = useApi<Details>(
    valid ? `/api/title/${type}/${id}` : null,
  );
  const library = useLibrary();
  const [showAllCast, setShowAllCast] = useState(false);
  useEffect(() => setShowAllCast(false), [type, id]);
  useEffect(() => {
    if (data) {
      library.visit(data);
      document.title = `${titleOf(data)} — movieboxd`;
    }
  }, [data]);
  if (loading) return <Loading hero />;
  if (error)
    return (
      <div className="page-content browse-page">
        <Link className="back-link" to="/">
          ← На главную
        </Link>
        <ErrorPanel error={error} retry={retry} />
      </div>
    );
  if (!data)
    return (
      <Empty
        title="История не найдена"
        text="Проверьте ссылку или найдите фильм через поиск."
      />
    );
  const trailer = data.videos?.results.find(
    (v) =>
      v.site === "YouTube" && v.type === "Trailer" && /^[\w-]{11}$/.test(v.key),
  );
  const director = data.credits?.crew.find((p) => p.job === "Director");
  const bg = imageUrl(data.backdrop_path, "original");
  return (
    <>
      <section
        className="details-hero"
        style={bg ? { backgroundImage: `url("${bg}")` } : {}}
      >
        <div className="hero-vignette" />
        <div className="details-inner">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> На главную
          </Link>
          <div className="details-layout">
            <div className="details-poster">
              <Poster movie={data} />
            </div>
            <div className="details-copy">
              <span className="eyebrow">
                {data.media_type === "tv" ? "СЕРИАЛ" : "ФИЛЬМ"} · {yearOf(data)}
              </span>
              <h1>{titleOf(data)}</h1>
              <p className="original-title">
                {data.original_title || data.original_name}
              </p>
              <div className="hero-meta">
                <span className="hero-score">
                  <Star size={15} fill="currentColor" />
                  {data.vote_average > 0 ? data.vote_average.toFixed(1) : "—"}
                  <small>TMDB</small>
                </span>
                {data.runtime ? <span>{data.runtime} мин.</span> : null}
                {data.number_of_seasons ? (
                  <span>Сезонов: {data.number_of_seasons}</span>
                ) : null}
                <span>{data.original_language?.toUpperCase()}</span>
              </div>
              <div className="genre-tags">
                {data.genres?.map((g) => (
                  <span key={g.id}>{g.name}</span>
                ))}
              </div>
              <p className="synopsis">
                {data.overview ||
                  "Описание на русском языке пока не добавлено в TMDB."}
              </p>
              <div className="hero-buttons">
                <WatchButton key={keyOf(data)} movie={data} />
                <SaveButton movie={data} full />
                {trailer && (
                  <a
                    className="button primary"
                    href={`https://www.youtube.com/watch?v=${trailer.key}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Трейлер <ExternalLink size={16} />
                  </a>
                )}
              </div>
              <p className="availability-note">
                <Info size={14} /> Доступность зависит от страны. Проверяйте
                условия на платформе.
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="page-content">
        <section className="credits-section">
          <div>
            <span className="eyebrow">СОЗДАТЕЛИ</span>
            <h2>{director ? "Режиссёр" : "Оригинальный язык"}</h2>
            <p>
              {director?.id ? (
                <Link to={`/person/${director.id}`}>{director.name}</Link>
              ) : (
                director?.name ||
                data.original_language?.toUpperCase() ||
                "Не указан"
              )}
            </p>
          </div>
          <div>
            <span className="eyebrow">В КАДРЕ</span>
            <h2>В главных ролях</h2>
            <div className="cast-list">
              {data.credits?.cast
                .slice(0, showAllCast ? undefined : 12)
                .map((p) => (
                  <Link
                    className="actor-link"
                    to={`/person/${p.id}`}
                    key={p.id}
                    aria-label={`Профиль: ${p.name}`}
                  >
                    <div className="actor-photo">
                      <PersonPhoto path={p.profile_path} name={p.name} />
                    </div>
                    <div className="actor-copy">
                      <strong>{p.name}</strong>
                      <span>{p.character}</span>
                    </div>
                  </Link>
                ))}
              {!data.credits?.cast.length && (
                <p>Информация ещё не добавлена.</p>
              )}
            </div>
            {data.credits?.cast.length > 12 && (
              <button
                className="button secondary cast-expand"
                aria-expanded={showAllCast}
                onClick={() => setShowAllCast(!showAllCast)}
              >
                {showAllCast
                  ? "Свернуть список"
                  : `Весь актёрский состав (${data.credits.cast.length})`}
              </button>
            )}
          </div>
        </section>
        <Rail
          title="Вам может понравиться"
          movies={data.recommendations?.results || []}
        />
      </div>
    </>
  );
}
function Footer() {
  return (
    <footer aria-label="О проекте и источниках">
      <div className="footer-top">
        <Link className="wordmark" to="/">
          movieboxd<span>•</span>
        </Link>
        <p>Для тех, кто любит кино.</p>
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noreferrer"
          className="tmdb-credit"
        >
          Данные и изображения{" "}
          <img
            src="/tmdb-logo.svg"
            alt="TMDB"
            style={{ width: 70, height: "auto" }}
          />
          <ExternalLink size={12} />
        </a>
      </div>
      <div className="footer-bottom">
        <span>Личная коллекция. Большой мир кино.</span>
        <span>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </span>
      </div>
    </footer>
  );
}
export default function App() {
  const location = useLocation();
  const { warning } = useLibrary();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (
      !location.pathname.startsWith("/title/") &&
      !location.pathname.startsWith("/person/")
    )
      document.title = "movieboxd — кино начинается здесь";
  }, [location.pathname, location.search]);
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <Header />
      {warning && (
        <div className="storage-warning" role="status">
          Браузер не разрешил сохранить коллекцию. Она доступна до закрытия
          страницы.
        </div>
      )}
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Browse search />} />
          <Route path="/catalog/:collection" element={<Browse />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/title/:type/:id" element={<TitlePage />} />
          <Route path="/person/:id" element={<PersonPage Card={Card} />} />
          <Route
            path="*"
            element={
              <Empty
                title="Эта сцена ещё не снята"
                text="Страница не найдена. Вернёмся к хорошему кино?"
              />
            }
          />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
