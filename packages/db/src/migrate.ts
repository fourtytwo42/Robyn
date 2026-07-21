import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDatabase } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(here, "../migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (migrationFiles.length === 0) throw new Error("No migrations found");
process.env.PGPOOL_SIZE = "1";
const { sql } = createDatabase();

try {
  for (const file of migrationFiles) {
    const migration = await readFile(
      resolve(migrationsDirectory, file),
      "utf8",
    );
    await sql.unsafe(migration);
  }
  const result = await sql.unsafe<{ version: string }[]>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  process.stdout.write(
    "Applied migrations: " + result.map((row) => row.version).join(", ") + "\n",
  );
} finally {
  await sql.end();
}
