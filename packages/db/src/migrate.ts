import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDatabase } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(
  resolve(here, "../migrations/0001_initial.sql"),
  "utf8",
);
process.env.PGPOOL_SIZE = "1";
const { sql } = createDatabase();

try {
  await sql.unsafe(migration);
  const result = await sql.unsafe<{ version: string }[]>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  process.stdout.write(
    "Applied migrations: " + result.map((row) => row.version).join(", ") + "\n",
  );
} finally {
  await sql.end();
}
