import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HomePage } from "./HomePage";

const navigateMock = vi.fn();
vi.mock("vike/client/router", () => ({ navigate: (...a: unknown[]) => navigateMock(...a) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  navigateMock.mockReset();
});

const image = {
  id: "img1",
  file_name: "cat.png",
  created: "2026-06-05T00:00:00Z",
  master_filetype: "image/png",
  links: { view: "/i/img1", direct: "/i/img1.png" },
};

function page(over: Partial<{ images: typeof image[]; total: number; page: number; pageSize: number }> = {}) {
  return { images: [image], total: 1, page: 1, pageSize: 24, ...over };
}

test("renders the provided images", () => {
  render(<HomePage data={page()} />);
  const img = screen.getByAltText("cat.png") as HTMLImageElement;
  expect(img.src).toContain("/i/img1");
});

test("shows page x / total and disables Prev on first page", () => {
  render(<HomePage data={page({ total: 50, page: 1, pageSize: 24 })} />);
  expect(screen.getByText("page 1 / 3")).toBeDefined();
  // 1 ページ目は Prev がリンクではない（span）
  const prev = screen.getByText("Prev");
  expect(prev.tagName).toBe("SPAN");
  const next = screen.getByText("Next") as HTMLAnchorElement;
  expect(next.tagName).toBe("A");
  expect(next.getAttribute("href")).toBe("/?page=2");
});

test("disables Next on the last page and links Prev", () => {
  render(<HomePage data={page({ total: 50, page: 3, pageSize: 24 })} />);
  const next = screen.getByText("Next");
  expect(next.tagName).toBe("SPAN");
  const prev = screen.getByText("Prev") as HTMLAnchorElement;
  expect(prev.getAttribute("href")).toBe("/?page=2");
});

test("uploads a selected file then navigates to page 1", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ id: "img1", file_name: "cat.png", links: { view: "/i/img1", direct: "/i/img1.png" } }),
      { status: 200 },
    ),
  );

  render(<HomePage data={page({ images: [], total: 0 })} />);

  const file = new File([new Uint8Array([1])], "cat.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/?page=1"));
  const [uploadPath, uploadInit] = fetchMock.mock.calls[0]!;
  expect(uploadPath).toBe("/api/image");
  expect(uploadInit.body).toBeInstanceOf(FormData);
});
