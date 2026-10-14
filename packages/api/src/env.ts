function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export const env = {
  jwtSecret: () => required("KUV_JWT_SECRET"),
  port: () => Number(optional("PORT", "3001")),
  db: () => ({
    host: optional("KUV_DB_HOST", "localhost"),
    port: Number(optional("KUV_DB_PORT", "5432")),
    user: optional("KUV_DB_USER", "kuv"),
    password: optional("KUV_DB_PASSWORD", "kuv"),
    database: optional("KUV_DB_DATABASE", "kuv"),
  }),
  s3: () => ({
    endpoint: required("KUV_S3_ENDPOINT"),
    region: optional("KUV_S3_REGION", "us-east-1"),
    bucket: required("KUV_S3_BUCKET"),
    accessKeyId: required("KUV_S3_ACCESS_KEY"),
    secretAccessKey: required("KUV_S3_SECRET_KEY"),
  }),
};
