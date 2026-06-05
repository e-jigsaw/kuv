import { useState } from "react";
import { apiPost } from "../lib/api";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost("/api/auth/password", { current, new: next });
      setStatus("done");
      setCurrent("");
      setNext("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex w-72 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Current password
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          autoComplete="new-password"
        />
      </label>
      {status === "done" && (
        <p className="text-sm text-green-400">password changed</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-400">password change failed</p>
      )}
      <button
        type="submit"
        className="rounded bg-blue-600 py-2 text-sm font-medium hover:bg-blue-500"
      >
        Change password
      </button>
    </form>
  );
}
