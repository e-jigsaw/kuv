import { useCallback, useState } from "react";
import { apiGet, uploadImage } from "../lib/api";
import type { ImageEntry } from "../lib/api";

export function HomePage({ initialImages }: { initialImages: ImageEntry[] }) {
  const [images, setImages] = useState<ImageEntry[]>(initialImages);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { images } = await apiGet<{ images: ImageEntry[] }>(
        "/api/image/list",
      );
      setImages(images);
    } catch {
      setError("failed to load images");
    }
  }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadImage(file);
      await reload();
    } catch {
      setError("upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center gap-4">
        <label className="cursor-pointer rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500">
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onUpload}
            disabled={busy}
            className="hidden"
            aria-label="Upload"
          />
        </label>
        {busy && <span className="text-sm text-neutral-400">uploading…</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {images.map((im) => (
          <a
            key={im.id}
            href={`/image/${im.id}`}
            className="group overflow-hidden rounded border border-neutral-800"
          >
            <img
              src={im.links.view}
              alt={im.file_name}
              loading="lazy"
              className="aspect-square w-full object-cover transition group-hover:opacity-80"
            />
            <p className="truncate px-2 py-1 text-xs text-neutral-400">
              {im.file_name}
            </p>
          </a>
        ))}
      </div>
      {images.length === 0 && !error && (
        <p className="text-sm text-neutral-500">No images yet.</p>
      )}
    </main>
  );
}
