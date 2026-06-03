import {
  apikey,
  image,
  imageDerivative,
  imageFile,
  settings,
  user,
} from "@picsur/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "./env.js";

// drizzle に渡すのはテーブルだけ（version 定数や DTO は含めない）
const schema = { user, apikey, settings, image, imageFile, imageDerivative };

export type Db = ReturnType<typeof createDb>;

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

// アプリ用のシングルトン（pg.Pool は遅延接続なので import 時点では接続しない）。
// テストでは createDb に専用 pool を渡す。
export const pool = new pg.Pool(env.db());
export const db = createDb(pool);
