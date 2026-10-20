import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";
import { pool } from "@healthcare/database";

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Healthcare API listening on port ${info.port}.`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
