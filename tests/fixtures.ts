// Fixed test data only. Never imported by the production application.
const titles = [
  "Интерстеллар",
  "Дюна: Часть вторая",
  "Оппенгеймер",
  "Бедные-несчастные",
  "Бегущий по лезвию 2049",
  "Начало",
  "Дюна",
  "Бойцовский клуб",
];
const posters = [
  "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
  "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
  "/ptpr0kGAckfQkJeJIt8st5dglvd.jpg",
  "/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg",
  "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
  "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
  "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
  "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
];
export const movies = titles.map((title, i) => ({
  id: i + 100,
  media_type: "movie",
  title,
  original_title: i ? title : "Interstellar",
  overview:
    "Когда время на Земле подходит к концу, команда исследователей отправляется за пределы нашей галактики, чтобы узнать, есть ли у человечества будущее среди звёзд.",
  poster_path: posters[i],
  backdrop_path: "/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
  vote_average: 8.6 - i * 0.1,
  release_date: `${2014 + i}-11-06`,
  original_language: "en",
}));
export const result = (items = movies, page = 1) => ({
  results: items,
  page,
  total_pages: 2,
  total_results: 16,
});
export const detail = {
  ...movies[0],
  runtime: 169,
  genres: [{ id: 878, name: "Фантастика" }],
  credits: {
    cast: [{ id: 1, name: "Мэттью Макконахи", character: "Купер" }],
    crew: [{ job: "Director", name: "Кристофер Нолан" }],
  },
  videos: {
    results: [
      { site: "YouTube", type: "Trailer", key: "zSWdZVtXT7E", name: "Трейлер" },
    ],
  },
  recommendations: result(movies.slice(1)),
};
