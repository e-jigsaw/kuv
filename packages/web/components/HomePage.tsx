import { useState } from "react";
import { navigate } from "vike/client/router";
import { uploadImage } from "../lib/api";
import type { ImageListPage } from "../lib/api";

export function HomePage({ data }: { data: ImageListPage }) {
  const { images, total, page, pageSize } = data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadImage(file);
      // 最新が先頭に来るので 1 ページ目へ。navigate が +data を再実行する。
      await navigate("/?page=1");
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

      {total === 0 && <p className="text-sm text-neutral-500">No images yet.</p>}

      {total > 0 && (
        <nav className="mt-6 flex items-center justify-center gap-4 text-sm">
          {page > 1 ? (
            <a href={`/?page=${page - 1}`} className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">
              Prev
            </a>
          ) : (
            <span className="rounded border border-neutral-800 px-3 py-1 text-neutral-600">Prev</span>
          )}
          <span className="text-neutral-400">page {page} / {totalPages}</span>
          {page < totalPages ? (
            <a href={`/?page=${page + 1}`} className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800">
              Next
            </a>
          ) : (
            <span className="rounded border border-neutral-800 px-3 py-1 text-neutral-600">Next</span>
          )}
        </nav>
      )}
    </main>
  );
}
