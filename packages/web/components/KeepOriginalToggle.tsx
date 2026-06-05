import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../lib/api";
import type { Settings } from "../lib/api";

export function KeepOriginalToggle() {
  const [keepOriginal, setKeepOriginal] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<Settings>("/api/settings")
      .then((s) => setKeepOriginal(s.keep_original))
      .catch(() => setError("failed to load settings"));
  }, []);

  const onToggle = async (next: boolean) => {
    setError(null);
    try {
      const s = await apiPut<Settings>("/api/settings", {
        keep_original: next,
      });
      setKeepOriginal(s.keep_original);
    } catch {
      setError("failed to save settings");
    }
  };

  if (keepOriginal === null && !error) {
    return <p className="text-sm text-neutral-500">loading…</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepOriginal ?? false}
          onChange={(e) => onToggle(e.target.checked)}
          className="size-4"
        />
        Keep original files on upload
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
