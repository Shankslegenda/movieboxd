import { test, expect } from "@playwright/test";
import { detail, movies } from "../fixtures";
const projects = movies
  .slice(0, 3)
  .map((m, i) => ({
    ...m,
    media_type: i === 1 ? "tv" : "movie",
    popularity: 10 - i,
    characters: i === 2 ? [] : ["Купер"],
    jobs: i === 2 ? ["Producer"] : [],
    asCast: i !== 2,
    asCrew: i === 2,
  }));
const person = {
  id: 1,
  name: "Мэттью Макконахи",
  profile_path: null,
  biography: "Actor biography",
  biographyLanguage: "en-US",
  birthday: "1969-11-04",
  place_of_birth: "Texas",
  deathday: null,
  projects,
};
test("cast opens actor profile, filters filmography and navigates back to a real title route", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/title/**", (r) => r.fulfill({ json: detail }));
  await page.route("**/api/person/1", (r) => r.fulfill({ json: person }));
  await page.goto("/title/movie/100");
  await page.getByRole("link", { name: "Профиль: Мэттью Макконахи" }).click();
  await expect(page).toHaveURL(/\/person\/1$/);
  await expect(page.getByRole("heading", { name: person.name })).toBeVisible();
  await expect(
    page.getByRole("img", { name: `Нет фотографии: ${person.name}` }),
  ).toBeVisible();
  await expect(
    page.getByText("На английском — русский перевод в TMDB отсутствует."),
  ).toBeVisible();
  await expect(page.locator(".movie-card")).toHaveCount(3);
  await page.getByLabel("Тип проекта").selectOption("tv");
  await expect(page.locator(".movie-card")).toHaveCount(1);
  await expect(page.locator(".card-title")).toHaveText(movies[1].title);
  await page.getByLabel("Тип проекта").selectOption("all");
  await page.getByLabel("Участие").selectOption("crew");
  await expect(page.locator(".movie-card")).toHaveCount(1);
  await expect(page.locator(".project-role")).toHaveText("Producer");
  await page.getByLabel("Участие").selectOption("all");
  await page.getByLabel("Поиск по проектам").fill("Ничегонет");
  await expect(
    page.getByRole("heading", { name: "Проекты не найдены" }),
  ).toBeVisible();
  await page.getByLabel("Поиск по проектам").fill("Интерстеллар");
  await expect(page.locator(".movie-card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Подробнее: Интерстеллар" }).click();
  await expect(page).toHaveURL(/\/title\/movie\/100$/);
  expect(errors).toEqual([]);
});
test("actor error is retryable and empty filmography is explicit", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/person/1", (r) =>
    ++calls === 1
      ? r.fulfill({
          status: 502,
          json: { message: "TMDB временно недоступен" },
        })
      : r.fulfill({ json: { ...person, biography: "", projects: [] } }),
  );
  await page.goto("/person/1");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Попробовать снова" }).click();
  await expect(page.getByRole("heading", { name: person.name })).toBeVisible();
  await expect(
    page.getByText("Биография пока не добавлена в TMDB."),
  ).toBeVisible();
  await expect(
    page.getByText("В TMDB пока нет проектов этого человека."),
  ).toBeVisible();
});
