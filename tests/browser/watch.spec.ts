import { test, expect, type Page } from "@playwright/test";
import { detail } from "../fixtures";
async function setup(page: Page) {
  await page.route("**/api/title/**", (route) =>
    route.fulfill({ json: detail }),
  );
  await page.route("**/api/direct-links/**", (route) =>
    route.fulfill({
      json: {
        titleId: 100,
        mediaType: "movie",
        sources: [
          {
            sourceId: "kinogo",
            status: "found",
            url: "https://kinogo2026.com/30928-test-interstellar.html",
            title: "Интерстеллар (2014)",
            year: "2014",
            matchedBy: "title_year",
            checkedAt: new Date().toISOString(),
          },
          {
            sourceId: "ifilm",
            status: "found",
            url: "https://ifilm.space/interstellar/",
            title: "Интерстеллар",
          },
          {
            sourceId: "nechego",
            status: "not_found",
            url: null,
            checkedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  await page.goto("/title/movie/100");
  await page.getByRole("button", { name: "Где смотреть", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
test("panel is responsive, scrollable and closes with Escape restoring focus", async ({
  page,
}) => {
  await setup(page);
  const d = page.getByRole("dialog");
  await expect(d.locator(".direct-source")).toHaveCount(3);
  expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const bounds = await d.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press("Escape");
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Где смотреть", exact: true }),
  ).toBeFocused();
});
test("panel shows only direct title links and makes no availability requests", async ({
  page,
}) => {
  const availabilityRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/watch/")) availabilityRequests.push(request.url());
  });
  await setup(page);
  const d = page.getByRole("dialog");
  const link = d.getByRole("link", { name: "Открыть Интерстеллар на Kinogo" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    "https://kinogo2026.com/30928-test-interstellar.html",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(d.getByText("Точное совпадение не найдено.")).toBeVisible();
  await expect(d.locator('a[href*="google.com"]')).toHaveCount(0);
  await expect(d.getByText("Доступность по данным TMDB / JustWatch")).toHaveCount(0);
  await expect(d.getByRole("combobox")).toHaveCount(0);
  expect(availabilityRequests).toEqual([]);
  await page.route("https://kinogo2026.com/**", (r) =>
    r.fulfill({ body: "Verified test title page" }),
  );
  const opened = page.waitForEvent("popup");
  await link.click();
  const popup = await opened;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(
    "https://kinogo2026.com/30928-test-interstellar.html",
  );
  await popup.close();
});
test("direct source retry replaces an error with a link and drops unsafe URLs", async ({
  page,
}) => {
  await setup(page);
  let count = 0;
  await page.route("**/api/direct-links/**", (r) =>
    r.fulfill({
      json: {
        sources: [
          {
            sourceId: "kinogo",
            status: ++count === 1 ? "unavailable" : "found",
            url:
              count === 1
                ? null
                : "https://kinogo2026.com/30928-test-interstellar.html",
            title: "Интерстеллар (2014)",
          },
          { sourceId: "ifilm", status: "found", url: "javascript:alert(1)" },
          {
            sourceId: "nechego",
            status: "found",
            url: "https://nechego.pw/interstellar",
            title: "Интерстеллар",
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Закрыть панель просмотра" }).click();
  await page.getByRole("button", { name: "Где смотреть", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Открыть Интерстеллар на Kinogo" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить поиск на сайтах" }).click();
  await expect(
    page.getByRole("link", { name: "Открыть Интерстеллар на Kinogo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Открыть Интерстеллар на iFilm" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Открыть Интерстеллар на Нечего смотреть" }),
  ).toHaveAttribute("href", "https://nechego.pw/interstellar");
});
