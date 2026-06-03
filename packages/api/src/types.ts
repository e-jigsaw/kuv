import type { Db } from "./db";
import type { AuthUser } from "./db/queries";

export interface AppBindings {
  Variables: {
    db: Db;
    user: AuthUser | null;
  };
}
