import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HomePage } from "./HomePage";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const listResponse = {
  images: [
    {
      id: "img1",
      file_name: "cat.png",
      created: "2026-06-05T00:00:00Z",
      master_filetype: "image/png",
      links: { view: "/i/img1", direct: "/i/img1.png" },
    },
  ],
};

test("renders the provided initial images", () => {
  render(<HomePage initialImages={listResponse.images} />);
  const img = screen.getByAltText("cat.png") as HTMLImageElement;
  expect(img.src).toContain("/i/img1");
});

test("uploads a selected file and refreshes the list", async () => {
  // 1回目: アップロード / 2回目: 再取得一覧
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "img1",
          file_name: "cat.png",
          links: { view: "/i/img1", direct: "/i/img1.png" },
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(listResponse), { status: 200 }),
    );

  render(<HomePage initialImages={[]} />);

  const file = new File([new Uint8Array([1])], "cat.png", { type: "image/png" });
  const input = screen.getByLabelText("Upload") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  // 1回目の呼び出しが multipart アップロード、2回目が一覧再取得
  const [uploadPath, uploadInit] = fetchMock.mock.calls[0]!;
  expect(uploadPath).toBe("/api/image");
  expect(uploadInit.body).toBeInstanceOf(FormData);
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/image/list");
});
