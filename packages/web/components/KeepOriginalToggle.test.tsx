import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KeepOriginalToggle } from "./KeepOriginalToggle";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

test("loads the current setting and toggles it", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ keep_original: false }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ keep_original: true }), { status: 200 }),
    );
  render(<KeepOriginalToggle />);

  const checkbox = (await screen.findByRole("checkbox")) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);

  fireEvent.click(checkbox);
  await waitFor(() => expect(checkbox.checked).toBe(true));

  const [path, init] = fetchMock.mock.calls[1]!;
  expect(path).toBe("/api/settings");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ keep_original: true });
});
