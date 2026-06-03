import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./bytea";
import { user } from "./auth";

// 画像メタデータ。id は アップロード内容の SHA-256 hex（content-addressed, dedupe）
export const image = pgTable("image", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
  fileName: text("file_name").notNull().default("image"),
});

// variant ごとの実バイト（master 必須 / original は keep_original 時のみ）
export const imageFile = pgTable(
  "image_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: text("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(), // 'master' | 'original'
    filetype: text("filetype").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [unique().on(t.imageId, t.variant)],
);

// オンデマンド形式変換のキャッシュ。key = sha256(対象形式)
export const imageDerivative = pgTable(
  "image_derivative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: text("image_id")
      .notNull()
      .references(() => image.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    filetype: text("filetype").notNull(),
    lastRead: timestamp("last_read", { withTimezone: true })
      .notNull()
      .defaultNow(),
    data: bytea("data").notNull(),
  },
  (t) => [unique().on(t.imageId, t.key)],
);
