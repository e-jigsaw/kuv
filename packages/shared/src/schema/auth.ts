import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 管理者ユーザー（単一ユーザー運用だがテーブルで保持）
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
});

// ShareX 等で使う API キー
export const apikey = pgTable("apikey", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  lastUsed: timestamp("last_used", { withTimezone: true }),
});

// アプリ設定（単一行: id=1 のみ。CHECK で単一行を強制）
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    keepOriginal: boolean("keep_original").notNull().default(false),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);
