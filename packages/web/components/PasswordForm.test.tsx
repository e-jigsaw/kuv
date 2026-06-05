import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PasswordForm } from "./PasswordForm";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

test("submits current and new password", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ),
  );
  render(<PasswordForm />);

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "old" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  await waitFor(() => expect(screen.getByText("password changed")).toBeDefined());
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/auth/password");
  expect(JSON.parse(init.body)).toEqual({ current: "old", new: "new-pass" });
});

test("shows an error when the current password is wrong", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "invalid credentials" }), {
        status: 401,
      }),
    ),
  );
  render(<PasswordForm />);

  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "wrong" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));

  await waitFor(() =>
    expect(screen.getByText("password change failed")).toBeDefined(),
  );
});
