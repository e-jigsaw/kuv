import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { user } from "@kuv/shared";
import pg from "pg";
import { createDb, type Db } from "../db";

export interface TestDb {
  db: Db;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
  teardown: () => Promise<void>;
}

// migration SQL の場所（packages/shared/drizzle/0000_*.sql）
function readMigrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzleDir = join(here, "../../../shared/drizzle");
  const file = readdirSync(drizzleDir).find(
    (f) => f.startsWith("0000_") && f.endsWith(".sql"),
  );
  if (!file) throw new Error("migration SQL not found in " + drizzleDir);
  return readFileSync(join(drizzleDir, file), "utf8");
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });

  // migration を適用（"--> statement-breakpoint" は SQL コメントなので無視される）
  const sql = readMigrationSql();
  await pool.query(sql);

  const db = createDb(pool);

  return {
    db,
    pool,
    container,
    teardown: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

// admin ユーザーを1人 seed して id を返す
export async function seedAdmin(
  db: Db,
  username: string,
  passwordHash: string,
): Promise<string> {
  const [row] = await db
    .insert(user)
    .values({ username, password: passwordHash })
    .returning({ id: user.id });
  return row!.id;
}
