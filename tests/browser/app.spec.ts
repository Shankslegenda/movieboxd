import { test, expect, type Page } from "@playwright/test";
import { movies, result, detail } from "../fixtures";
async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === "/api/home")
      body = {
        sections: ["trending", "popular", "top", "new", "tv", "anime"].map(
          (id) => ({
            id,
            ...result(
              movies.map((m) => ({
                ...m,
                media_type: id === "tv" || id === "anime" ? "tv" : "movie",
              })),
            ),
          }),
        ),
      };
    else if (url.pathname.startsWith("/api/title/")) body = detail;
    else if (url.pathname === "/api/search")
      body = result(
        url.searchParams.get("query") === "ничегонет"
          ? []
          : url.searchParams.get("page") === "2"
            ? [movies[1]]
            : [movies[0]],
        Number(url.searchParams.get("page") || 1),
      );
    else body = result();
    await route.fulfill({ json: body });
  });
}

test("unconfigured API shows a useful setup state, no invented catalogue", async ({
  page,
}) => {
  await page.route("**/api/home", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "TMDB_NOT_CONFIGURED", message: "Добавьте ключ TMDB" },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Подключите свою киновселенную" }),
  ).toBeVisible();
  await expect(page.locator(".movie-card")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Получить ключ TMDB" }),
  ).toHaveAttribute("href", "https://www.themoviedb.org/settings/api");
});
test("catalogue, details, trailer, favorites persistence and removal", async ({
  page,
}) => {
  await mockApi(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Интерстеллар", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "О фильме", exact: true }).click();
  await expect(page).toHaveURL(/\/title\/movie\/100$/);
  await expect(page.getByText("Кристофер Нолан")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Трейлер", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=zSWdZVtXT7E");
  await page
    .getByRole("button", { name: "В коллекцию: Интерстеллар", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Моя коллекция", exact: true })
    .first()
    .click();
  await expect(page.locator(".movie-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".movie-card")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Удалить из коллекции: Интерстеллар",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Здесь начинается ваша коллекция" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "movieboxd — главная" }).click();
  await expect(
    page.getByRole("heading", { name: "Продолжайте открывать" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("debounced search, filters, next page, empty results and clearing query", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Поиск фильмов и сериалов" });
  await input.fill("Интерстеллар");
  await expect(page).toHaveURL(/search\?q=/);
  await expect(page.locator(".movie-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Сериалы", exact: true }).click();
  await expect(page).toHaveURL(/type=tv/);
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".card-title")).toHaveText("Дюна: Часть вторая");
  await input.fill("ничегонет");
  await expect(
    page.getByRole("heading", { name: "Пока ничего не нашлось" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(page).toHaveURL(/\/$/);
});
test("late previous search cannot overwrite the newer query", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/search?**", async (route) => {
    const slow =
      new URL(route.request().url()).searchParams.get("query") === "старый";
    if (slow) await new Promise((r) => setTimeout(r, 1200));
    await route
      .fulfill({ json: result([movies[slow ? 0 : 1]]) })
      .catch(() => {});
  });
  await page.goto("/search?q=старый");
  await page
    .getByRole("textbox", { name: "Поиск фильмов и сериалов" })
    .fill("новый");
  await expect(page.locator(".card-title")).toHaveText("Дюна: Часть вторая");
  await page.waitForTimeout(1300);
  await expect(page.locator(".card-title")).toHaveText("Дюна: Часть вторая");
});
test("API error can be retried and broken posters have fallback", async ({
  page,
}) => {
  await mockApi(page);
  let failed = true;
  await page.route("**/api/catalog/popular?**", async (route) => {
    if (failed) {
      failed = false;
      await route.fulfill({
        status: 502,
        json: { code: "TMDB_UNREACHABLE", message: "TMDB временно недоступен" },
      });
    } else
      await route.fulfill({
        json: result([{ ...movies[0], poster_path: "/missing.jpg" }]),
      });
  });
  await page.route("**/missing.jpg", (route) => route.abort());
  await page.goto("/catalog/popular");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Попробовать снова" }).click();
  await expect(page.locator(".poster-fallback")).toHaveText("Интерстеллар");
});
test("responsive layout, hero selection, keyboard navigation and visual capture", async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator(".movie-card").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Показать фильм: Дюна: Часть вторая" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Дюна: Часть вторая", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Показать фильм: Интерстеллар" })
    .click();
  await page
    .locator(".poster-wrap img")
    .first()
    .evaluate((image: HTMLImageElement) => image.decode().catch(() => {}));
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-catalogue-fixture.png`),
    fullPage: true,
  });
});
test("corrupted browser storage does not crash the app", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("movieboxd.saved", "{invalid json");
  });
  await page.goto("/favorites");
  await expect(
    page.getByRole("heading", { name: "Здесь начинается ваша коллекция" }),
  ).toBeVisible();
});
