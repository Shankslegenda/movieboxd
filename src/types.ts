export type Media = {
  id: number;
  media_type: "movie" | "tv";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  original_language?: string;
};
export type Details = Media & {
  runtime?: number;
  number_of_seasons?: number;
  tagline?: string;
  genres: { id: number; name: string }[];
  credits: {
    cast: {
      id: number;
      name: string;
      character: string;
      profile_path?: string | null;
    }[];
    crew: { id?: number; job: string; name: string }[];
  };
  videos: {
    results: { site: string; type: string; key: string; name: string }[];
  };
  recommendations: Results;
};
export type Results = {
  results: Media[];
  page: number;
  total_pages: number;
  total_results: number;
};
export type Section = Results & { id: string; error?: string };
export const titleOf = (m: Media) => m.title || m.name || "Без названия";
export const yearOf = (m: Media) =>
  (m.release_date || m.first_air_date || "").slice(0, 4);
export const keyOf = (m: Media) => `${m.media_type}/${m.id}`;
export const imageUrl = (path: string | null | undefined, size = "w500") =>
  path && /^\/[\w.-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : undefined;
export const sections: Record<string, { title: string; note: string }> = {
  trending: {
    title: "В центре внимания",
    note: "Что смотрят и обсуждают сегодня",
  },
  popular: { title: "Популярное кино", note: "Истории, которые объединяют" },
  top: {
    title: "Кино с большой буквы",
    note: "Высокие оценки. Сильные впечатления.",
  },
  new: { title: "Сейчас в кино", note: "Новые истории на большом экране" },
  tv: {
    title: "Ещё одну серию",
    note: "Сериалы, от которых трудно оторваться",
  },
  anime: { title: "Мир аниме", note: "За пределами воображения" },
};

export type PersonProject = Media & {
  popularity: number;
  characters: string[];
  jobs: string[];
  asCast: boolean;
  asCrew: boolean;
};
export type PersonDetails = {
  id: number;
  name: string;
  profile_path: string | null;
  biography: string;
  biographyLanguage: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  known_for_department: string | null;
  also_known_as: string[];
  projects: PersonProject[];
};
