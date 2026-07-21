import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase() {
  const sql = postgres({
    host: process.env.PGHOST ?? "/var/run/postgresql",
    port: Number(process.env.PGPORT ?? "5432"),
    database: process.env.PGDATABASE ?? "robyn",
    username: process.env.PGUSER ?? "hendo420",
    max: Number(process.env.PGPOOL_SIZE ?? "10"),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle(sql, { schema }), sql };
}

export * from "./schema.js";
