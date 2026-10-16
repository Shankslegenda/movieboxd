// Intentionally opt-in. Uses your real TMDB token; never prints it.
import assert from "node:assert/strict";
import { buildApp } from "../server/app.ts";
if (!process.env.TMDB_READ_ACCESS_TOKEN && !process.env.TMDB_API_KEY) {
  console.error(
    "LIVE CHECK NOT RUN: add TMDB_READ_ACCESS_TOKEN to .env first.",
  );
  process.exit(1);
}
const app = buildApp({
  token: process.env.TMDB_READ_ACCESS_TOKEN,
  apiKey: process.env.TMDB_API_KEY,
});
try {
  const home = await app.inject("/api/home");
  assert.equal(home.statusCode, 200, `Home failed: ${home.body}`);
  assert.ok(home.json().sections.some((s: any) => s.results.length > 0));
  const search = await app.inject("/api/search?query=Interstellar&type=movie");
  assert.equal(search.statusCode, 200, `Search failed: ${search.body}`);
  const movie = search.json().results[0];
  assert.ok(movie?.id, "Search did not return a movie");
  const detail = await app.inject(`/api/title/movie/${movie.id}`);
  assert.equal(detail.statusCode, 200, `Details failed: ${detail.body}`);
  assert.equal(detail.json().id, movie.id);
  const actorId = detail.json().credits.cast[0]?.id;
  assert.ok(actorId, "Live movie has no cast");
  const person = await app.inject(`/api/person/${actorId}`);
  assert.equal(person.statusCode, 200);
  assert.equal(person.json().id, actorId);
  assert.ok(person.json().name && person.json().projects.length > 0);
  assert.ok(
    person
      .json()
      .projects.some((p: any) => p.id === movie.id && p.media_type === "movie"),
  );
  for (const [type, id, region] of [
    ["movie", 27205, "KZ"],
    ["movie", 27205, "US"],
    ["tv", 1399, "GB"],
  ]) {
    const availability = await app.inject(
      `/api/watch/${type}/${id}?region=${region}`,
    );
    assert.equal(availability.statusCode, 200);
    assert.equal(availability.json().region, region);
    assert.ok(Array.isArray(availability.json().providers));
    console.log(
      `LIVE availability: ${type}/${id}, ${region}, ${availability.json().providers.length} offers, coverage=${availability.json().regionSupported}`,
    );
  }
  console.log(
    "LIVE TMDB CHECK PASSED: home, search, title details, actor profile/credits, movie and TV availability.",
  );
} finally {
  await app.close();
}
