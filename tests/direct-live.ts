// Opt-in external integration test. No fixture data, no secret output.
import assert from "node:assert/strict";
import { buildApp } from "../server/app.ts";
const app = buildApp({
  token: process.env.TMDB_READ_ACCESS_TOKEN,
  apiKey: process.env.TMDB_API_KEY,
});
try {
  for (const [type, id] of [
    ["movie", 27205],
    ["movie", 157336],
    ["movie", 965150],
    ["tv", 1399],
  ] as const) {
    const response = await app.inject(`/api/direct-links/${type}/${id}`);
    assert.equal(response.statusCode, 200, "Direct-link API failed");
    for (const source of response.json().sources) {
      console.log(
        `${type}/${id} | ${source.sourceId} | ${source.status} | ${source.url || "no link"} | match=${source.matchedBy || "none"}`,
      );
      if (source.sourceId === "hdrezka") {
        assert.equal(source.status, "needs_source");
        continue;
      }
      // These catalogs do not currently contain a matching first-season page.
      // Keep the existing Kinogo TV regression; don't label absent new-source entries as working.
      if (type === "tv" && source.sourceId !== "kinogo") {
        assert.equal(source.status, "not_found");
        assert.equal(source.url, null);
        continue;
      }
      assert.equal(
        source.status,
        "found",
        `${source.sourceId} did not return a verified page for ${type}/${id}`,
      );
      assert.equal(source.matchedBy, "title_year");
    }
  }
  console.log(
    "LIVE DIRECT LINKS PASSED: 3 movies on Kinogo, iFilm and Nechego, plus Kinogo TV. Exact title/year/type matches; no fixture data. Playback not tested.",
  );
} finally {
  await app.close();
}
