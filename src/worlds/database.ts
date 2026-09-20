import fs from "fs/promises";
import path from "path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const migrationsPath = path.resolve(__dirname, "..", "..", "migrations");

const runMigrations = async (): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS "SchemaMigration" (
        "name" TEXT PRIMARY KEY
      )
    `);

    const migrations = (await fs.readdir(migrationsPath))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of migrations) {
      const applied = await client.query(
        'SELECT 1 FROM "SchemaMigration" WHERE "name" = $1',
        [name],
      );

      if (applied.rowCount) continue;

      await client.query(
        await fs.readFile(path.join(migrationsPath, name), "utf8"),
      );

      await client.query('INSERT INTO "SchemaMigration" ("name") VALUES ($1)', [
        name,
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export { pool, runMigrations };
