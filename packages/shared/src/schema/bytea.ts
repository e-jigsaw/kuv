import { customType } from "drizzle-orm/pg-core";

// Postgres bytea を Node の Buffer として扱うカスタム型
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
