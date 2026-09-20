import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";
import { logger } from "../../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  logger.info("Database schema is up to date");
  await pool.end();
}

migrate().catch((err) => {
  logger.error("Migration failed", { error: (err as Error).message });
  process.exit(1);
});
