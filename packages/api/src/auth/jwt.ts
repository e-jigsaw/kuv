import { sign, verify } from "hono/jwt";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthPayload {
  uid: string;
  exp: number;
}

export async function signAuthToken(
  uid: string,
  secret: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ uid, exp }, secret);
}

export async function verifyAuthToken(
  token: string,
  secret: string,
): Promise<AuthPayload | null> {
  try {
    const payload = await verify(token, secret, "HS256");
    if (typeof payload.uid !== "string") return null;
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}
