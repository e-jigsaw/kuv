import { useState } from "react";
import { apiDelete } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function ImageView({
  image,
  onDeleted,
}: {
  image: ImageEntry;
  onDeleted: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCopy = async () => {
    await navigator.clipboard.writeText(
      new URL(image.links.direct, window.location.origin).href,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDelete = async () => {
    if (!confirm(`Delete ${image.file_name}?`)) return;
    try {
      await apiDelete(`/api/image/${image.id}`);
      onDeleted();
    } catch {
      setError("delete failed");
    }
  };

  return (
    <main className="flex flex-col items-center gap-4 p-6">
      <img
        src={image.links.view}
        alt={image.file_name}
        className="max-h-[70vh] max-w-full rounded border border-neutral-800"
      />
      <div className="flex flex-col items-center gap-2 text-sm">
        <p className="font-medium">{image.file_name}</p>
        <p className="text-neutral-500">
          {new Date(image.created).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-300 hover:bg-neutral-900"
          title="Copy direct link"
        >
          {copied ? "copied!" : image.links.direct}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded bg-red-700 px-4 py-1.5 text-sm font-medium hover:bg-red-600"
        >
          Delete
        </button>
        {error && <p className="text-red-400">{error}</p>}
      </div>
    </main>
  );
}
