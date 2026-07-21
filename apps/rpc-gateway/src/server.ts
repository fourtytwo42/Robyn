import { buildGateway } from "./app.js";
import { createRedisRateLimiter } from "./rate-limit.js";

const port = Number.parseInt(process.env.PORT ?? "8546", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const rateLimiter = await createRedisRateLimiter(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
);
const app = buildGateway({ rateLimiter });

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
