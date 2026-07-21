import { Queue } from "bullmq";

if ((process.env.ROBYN_ENV ?? "") !== "robyn-devnet") {
  throw new Error("Dead-letter retry is available only on robyn-devnet");
}
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const queue = new Queue("robyn-conversions", {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || "6379"),
    maxRetriesPerRequest: null,
  },
});
try {
  const failed = await queue.getFailed(0, 99);
  for (const job of failed) await job.retry("failed");
  process.stdout.write(
    JSON.stringify({ queue: "robyn-conversions", retried: failed.length }) +
      "\n",
  );
} finally {
  await queue.close();
}
