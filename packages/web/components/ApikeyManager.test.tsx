import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ApikeyManager } from "./ApikeyManager";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

const key1 = {
  id: "k1",
  name: "sharex",
  key: "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH",
  created: "2026-06-05T00:00:00Z",
  last_used: null,
};

test("lists keys and issues a new one", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikey: { ...key1, id: "k2", name: "new" } }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ apikeys: [{ ...key1, id: "k2", name: "new" }, key1] }),
        { status: 200 },
      ),
    );
  render(<ApikeyManager initialKeys={[key1]} />);

  expect(screen.getByText("sharex")).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "New key" }));
  await waitFor(() => expect(screen.getByText("new")).toBeDefined());
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/apikey");
  expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
});

test("revokes a key after confirmation", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ apikeys: [] }), { status: 200 }),
    );
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  render(<ApikeyManager initialKeys={[key1]} />);

  expect(screen.getByText("sharex")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

  await waitFor(() => expect(screen.queryByText("sharex")).toBeNull());
  expect(fetchMock.mock.calls[0]![0]).toBe("/api/apikey/k1");
  expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
});
