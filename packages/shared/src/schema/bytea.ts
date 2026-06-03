import { customType } from "drizzle-orm/pg-core";

// Postgres bytea を Node の Buffer として扱う。
// pg(node-postgres) ドライバは bytea をそのまま Buffer で返すため fromDriver/toDriver は不要。
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
