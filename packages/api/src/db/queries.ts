import { apikey, user } from "@picsur/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db";

export interface AuthUser {
  id: string;
  username: string;
}

export async function getUserByUsername(
  db: Db,
  username: string,
): Promise<(AuthUser & { password: string }) | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.username, username))
    .limit(1);
  return row ?? null;
}

export async function getUserById(
  db: Db,
  id: string,
): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  return row ?? null;
}

// apikey を解決し、対応する user を返す。見つかれば last_used を更新。
export async function resolveApikey(
  db: Db,
  key: string,
): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: user.id, username: user.username, apikeyId: apikey.id })
    .from(apikey)
    .innerJoin(user, eq(apikey.userId, user.id))
    .where(eq(apikey.key, key))
    .limit(1);
  if (!row) return null;

  await db
    .update(apikey)
    .set({ lastUsed: new Date() })
    .where(eq(apikey.id, row.apikeyId));

  return { id: row.id, username: row.username };
}
