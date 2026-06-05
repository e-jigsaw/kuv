import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ImageView } from "./ImageView";

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

test("renders image, metadata and direct link", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(listResponse), { status: 200 })),
  );
  render(<ImageView id="img1" onDeleted={vi.fn()} />);

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  expect(screen.getByText("cat.png")).toBeDefined();
  // direct リンクのコピー UI が出ている
  expect(screen.getByText("/i/img1.png")).toBeDefined();
});

test("shows not found for an unknown id", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ images: [] }), { status: 200 }),
    ),
  );
  render(<ImageView id="missing" onDeleted={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("image not found")).toBeDefined());
});

test("deletes after confirmation and calls onDeleted", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(listResponse), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const onDeleted = vi.fn();
  render(<ImageView id="img1" onDeleted={onDeleted} />);

  await waitFor(() => expect(screen.getByAltText("cat.png")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe("/api/image/img1");
  expect(init.method).toBe("DELETE");
});
