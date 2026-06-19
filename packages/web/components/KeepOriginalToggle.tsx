import { useState } from "react";
import { apiPut } from "../lib/api";
import type { Settings } from "../lib/api";

export function KeepOriginalToggle({
  initialKeepOriginal,
}: {
  initialKeepOriginal: boolean;
}) {
  const [keepOriginal, setKeepOriginal] = useState(initialKeepOriginal);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepOriginal}
          onChange={(e) => onToggle(e.target.checked)}
          className="size-4"
        />
        Keep original files on upload
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
