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
  jwtSecret: () => required("PICSUR_JWT_SECRET"),
  port: () => Number(optional("PORT", "3001")),
  db: () => ({
    host: optional("PICSUR_DB_HOST", "localhost"),
    port: Number(optional("PICSUR_DB_PORT", "5432")),
    user: optional("PICSUR_DB_USER", "picsur"),
    password: optional("PICSUR_DB_PASSWORD", "picsur"),
    database: optional("PICSUR_DB_DATABASE", "picsur"),
  }),
};
