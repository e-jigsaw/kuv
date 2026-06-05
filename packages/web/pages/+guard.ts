import { redirect } from "vike/abort";
import type { GuardAsync } from "vike/types";

// 全ページ共通の認証ガード（ssr:false なのでクライアントで実行される）。
// /login だけは未認証で開ける。それ以外は /api/auth/me が 401 なら /login へ。
const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // prerender（build 時、node 環境）では認証チェック不能なので素通り
  if (typeof window === "undefined") return;
  if (pageContext.urlPathname === "/login") return;

  const res = await fetch("/api/auth/me");
  if (res.status === 401) {
    throw redirect("/login");
  }
};

export { guard };
