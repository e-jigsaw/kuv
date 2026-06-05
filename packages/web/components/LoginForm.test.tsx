import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  cleanup();
});

test("submits credentials and calls onLoggedIn on success", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ user: { id: "u1", username: "admin" } }), {
        status: 200,
      }),
    ),
  );
  const onLoggedIn = vi.fn();
  render(<LoginForm onLoggedIn={onLoggedIn} />);

  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));

  await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls[0]!;
  expect(path).toBe("/api/auth/login");
  expect(JSON.parse(init.body)).toEqual({
    username: "admin",
    password: "hunter2",
  });
});

test("shows an error on failed login", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "invalid credentials" }), {
        status: 401,
      }),
    ),
  );
  render(<LoginForm onLoggedIn={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("Username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "wrong" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));

  await waitFor(() =>
    expect(screen.getByText("login failed")).toBeDefined(),
  );
});
