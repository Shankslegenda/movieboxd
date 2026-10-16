import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../server/app.ts";
const movie = {
  id: 100,
  media_type: "movie",
  title: "Проект",
  popularity: 5,
  character: "Hero",
};
const person = {
  id: 42,
  name: "Test Actor",
  biography: "Биография",
  combined_credits: {
    cast: [
      movie,
      { ...movie, character: "Other role" },
      { ...movie, media_type: "tv", name: "Series", popularity: 10 },
      { ...movie, id: 200, adult: true },
      { ...movie, id: 0 },
    ],
    crew: [{ ...movie, job: "Producer" }],
  },
};
function appWith(handler: (url: URL) => Response) {
  return buildApp({
    token: "test-only",
    fetcher: ((url: any) =>
      Promise.resolve(handler(new URL(String(url))))) as typeof fetch,
  });
}
test("person merges repeated credits but preserves movies and TV with same id and multiple roles", async (t) => {
  let requested = "";
  const app = appWith((url) => {
    requested = url.pathname + url.search;
    return Response.json(person);
  });
  t.after(() => app.close());
  const result = await app.inject("/api/person/42");
  assert.equal(result.statusCode, 200);
  const data = result.json();
  assert.equal(data.name, "Test Actor");
  assert.equal(data.projects.length, 2);
  assert.equal(data.projects[0].media_type, "tv");
  assert.equal(data.profile_path, null);
  const m = data.projects[1];
  assert.deepEqual(m.characters, ["Hero", "Other role"]);
  assert.deepEqual(m.jobs, ["Producer"]);
  assert.equal(m.asCast, true);
  assert.equal(m.asCrew, true);
  assert.equal(m.vote_average, 0);
  assert.equal(m.poster_path, null);
  assert.match(requested, /append_to_response=combined_credits/);
  assert.match(requested, /language=ru-RU/);
});
test("missing Russian biography falls back to English and labels its language", async (t) => {
  const app = appWith((url) =>
    Response.json(
      url.searchParams.get("language") === "en-US"
        ? { id: 42, biography: "English biography" }
        : { ...person, biography: "" },
    ),
  );
  t.after(() => app.close());
  const data = (await app.inject("/api/person/42")).json();
  assert.equal(data.biography, "English biography");
  assert.equal(data.biographyLanguage, "en-US");
  assert.equal(data.projects.length, 2);
});
test("optional biography failure does not discard projects", async (t) => {
  const app = appWith((url) =>
    url.searchParams.get("language") === "en-US"
      ? new Response("", { status: 500 })
      : Response.json({ ...person, biography: null }),
  );
  t.after(() => app.close());
  const r = await app.inject("/api/person/42");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().biography, "");
  assert.equal(r.json().projects.length, 2);
});
test("invalid person requests are rejected without upstream calls", async (t) => {
  let calls = 0;
  const app = appWith(() => {
    calls++;
    return Response.json(person);
  });
  t.after(() => app.close());
  for (const path of [
    "/api/person/0",
    "/api/person/-1",
    "/api/person/nope",
    "/api/person/2147483648",
    "/api/person/42?language=xx",
  ])
    assert.equal((await app.inject(path)).statusCode, 400, path);
  assert.equal(calls, 0);
});
test("person errors, adult profiles and malformed responses never become successful empty profiles", async (t) => {
  for (const [body, status] of [
    [{ ...person, adult: true }, 404],
    [{ ...person, id: 43 }, 502],
    [{ ...person, combined_credits: {} }, 502],
  ] as const) {
    const app = appWith(() => Response.json(body));
    t.after(() => app.close());
    assert.equal((await app.inject("/api/person/42")).statusCode, status);
  }
  const missing = appWith(() => new Response("", { status: 404 }));
  t.after(() => missing.close());
  assert.equal((await missing.inject("/api/person/42")).statusCode, 404);
});
