import { apikey } from "@kuv/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db";

export interface ApikeyEntry {
  id: string;
  name: string;
  key: string;
  created: Date;
  lastUsed: Date | null;
}

const entryColumns = {
  id: apikey.id,
  name: apikey.name,
  key: apikey.key,
  created: apikey.created,
  lastUsed: apikey.lastUsed,
};

// 自分の apikey 一覧（created desc）。key は平文保存方式（旧実装踏襲）なのでそのまま返す。
export async function listApikeys(
  db: Db,
  userId: string,
): Promise<ApikeyEntry[]> {
  return db
    .select(entryColumns)
    .from(apikey)
    .where(eq(apikey.userId, userId))
    .orderBy(desc(apikey.created));
}

export async function createApikey(
  db: Db,
  userId: string,
  name: string,
  key: string,
): Promise<ApikeyEntry> {
  const [row] = await db
    .insert(apikey)
    .values({ userId, name, key })
    .returning(entryColumns);
  return row!;
}

// 所有者一致で削除。消えたら true。
// id は UUID 文字列であること（non-UUID は pg が uuid パースエラーを throw する — 呼び出し側でガード）。
export async function deleteApikey(
  db: Db,
  id: string,
  userId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.userId, userId)))
    .returning({ id: apikey.id });
  return deleted.length > 0;
}
