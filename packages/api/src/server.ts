import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { db } from "./db";
import { env } from "./env";
import { createS3BlobStore } from "./services/blob-store";

const app = createApp(db, createS3BlobStore(env.s3()));
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port });
console.log(`api listening on :${port}`);
