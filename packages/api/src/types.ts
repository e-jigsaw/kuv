import type { Db } from "./db";
import type { AuthUser } from "./db/queries";
import type { BlobStore } from "./services/blob-store";

export interface AppBindings {
  Variables: {
    db: Db;
    blob: BlobStore;
    user: AuthUser | null;
  };
}
