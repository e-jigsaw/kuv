import { useState } from "react";
import { apiPost } from "../lib/api";
import type { Me } from "../lib/api";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost<Me>("/api/auth/login", { username, password });
      onLoggedIn();
    } catch {
      setError("login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-32 flex w-72 flex-col gap-4">
      <h1 className="text-center text-2xl font-bold">kuv</h1>
      <label className="flex flex-col gap-1 text-sm">
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="username"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        Login
      </button>
    </form>
  );
}
