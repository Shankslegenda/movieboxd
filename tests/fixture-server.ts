// Local browser QA only: production build + real Fastify routes + controlled upstream responses.
import { buildApp } from "../server/app.ts";
import { movies, result, detail } from "./fixtures.ts";
const app = buildApp({
  token: "fixture-not-a-real-token",
  fetcher: (async (input: any) => {
    const url = new URL(String(input));
    let data: unknown;
    if (url.pathname.includes("/search/")) {
      const query = url.searchParams.get("query") || "";
      if (query === "ошибка") return new Response("", { status: 500 });
      const matches = movies.filter((m) =>
        m.title.toLowerCase().includes(query.toLowerCase()),
      );
      data = { ...result(matches), total_pages: 1 };
    } else if (/\/(movie|tv)\/\d+$/.test(url.pathname)) {
      const found = movies.find(
        (m) => String(m.id) === url.pathname.split("/").at(-1),
      );
      if (!found) return new Response("", { status: 404 });
      data = { ...detail, ...found };
    } else data = result();
    return Response.json(data);
  }) as typeof fetch,
});
await app.listen({ port: 4174, host: "127.0.0.1" });
console.log("TEST FIXTURES ONLY — http://127.0.0.1:4174");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
