import { useCallback, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import type { ApikeyEntry } from "../lib/api";

export function ApikeyManager({
  initialKeys,
}: {
  initialKeys: ApikeyEntry[];
}) {
  const [keys, setKeys] = useState<ApikeyEntry[]>(initialKeys);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { apikeys } = await apiGet<{ apikeys: ApikeyEntry[] }>(
        "/api/apikey",
      );
      setKeys(apikeys);
    } catch {
      setError("failed to load api keys");
    }
  }, []);

  const onIssue = async () => {
    setError(null);
    try {
      await apiPost("/api/apikey", {});
      await reload();
    } catch {
      setError("failed to issue a key");
    }
  };

  const onRevoke = async (k: ApikeyEntry) => {
    if (!confirm(`Revoke "${k.name}"?`)) return;
    setError(null);
    try {
      await apiDelete(`/api/apikey/${k.id}`);
      await reload();
    } catch {
      setError("failed to revoke the key");
    }
  };

  const onCopy = async (k: ApikeyEntry) => {
    await navigator.clipboard.writeText(k.key);
    setCopiedId(k.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onIssue}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          New key
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2 text-sm"
          >
            <span className="w-32 truncate font-medium">{k.name}</span>
            <button
              type="button"
              onClick={() => onCopy(k)}
              className="flex-1 truncate text-left font-mono text-xs text-neutral-400 hover:text-neutral-100"
              title="Copy key"
            >
              {copiedId === k.id ? "copied!" : k.key}
            </button>
            <button
              type="button"
              onClick={() => onRevoke(k)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {keys.length === 0 && (
        <p className="text-sm text-neutral-500">No api keys.</p>
      )}
    </div>
  );
}
