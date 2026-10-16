import { buildApp } from "./app.ts";
const app = buildApp({
  token: process.env.TMDB_READ_ACCESS_TOKEN,
  apiKey: process.env.TMDB_API_KEY,
  database: process.env.TMDB_CACHE_PATH || ".data/tmdb.sqlite",
  // Accept forwarding only through internal proxies on the hosting network.
  trustHostingProxy: process.env.RENDER === "true" || process.env.TRUST_HOSTING_PROXY === "true",
});
try {
  const address = await app.listen({
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || "127.0.0.1",
  });
  console.log(`movieboxd API: ${address}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
