import type { ReactNode } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { apiPost } from "../lib/api";
import "./tailwind.css";

function Header() {
  const onLogout = async () => {
    await apiPost("/api/auth/logout");
    // ガードに任せず明示的に遷移（full reload で状態も破棄）
    window.location.href = "/login";
  };

  return (
    <header className="flex items-center gap-6 border-b border-neutral-800 px-6 py-3">
      <a href="/" className="text-lg font-bold">
        Picsur
      </a>
      <nav className="flex flex-1 gap-4 text-sm text-neutral-400">
        <a href="/" className="hover:text-neutral-100">
          Images
        </a>
        <a href="/settings" className="hover:text-neutral-100">
          Settings
        </a>
      </nav>
      <button
        type="button"
        onClick={onLogout}
        className="text-sm text-neutral-400 hover:text-neutral-100"
      >
        Logout
      </button>
    </header>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const pageContext = usePageContext();
  const isLogin = pageContext.urlPathname === "/login";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {!isLogin && <Header />}
      {children}
    </div>
  );
}
