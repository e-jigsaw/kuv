import { useEffect, useState } from "react";
import { apiDelete, apiGet } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function ImageView({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted: () => void;
}) {
  const [image, setImage] = useState<ImageEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { images } = await apiGet<{ images: ImageEntry[] }>(
          "/api/image/list",
        );
        setImage(images.find((im) => im.id === id) ?? null);
      } catch {
        setError("failed to load image");
      } finally {
        setLoaded(true);
      }
    })();
  }, [id]);

  const onCopy = async () => {
    if (!image) return;
    await navigator.clipboard.writeText(
      new URL(image.links.direct, window.location.origin).href,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDelete = async () => {
    if (!image) return;
    if (!confirm(`Delete ${image.file_name}?`)) return;
    try {
      await apiDelete(`/api/image/${image.id}`);
      onDeleted();
    } catch {
      setError("delete failed");
    }
  };

  if (!loaded) return <main className="p-6 text-neutral-500">loading…</main>;
  if (error) return <main className="p-6 text-red-400">{error}</main>;
  if (!image) return <main className="p-6 text-neutral-500">image not found</main>;

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
      </div>
    </main>
  );
}
