import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { clearSessionToken, getSessionToken } from "../../api/client";
import OwnerSignUpPage from "./OwnerSignUpPage";

afterEach(() => { vi.unstubAllGlobals(); clearSessionToken(); });

it("verifies an owner code before entering My restaurants", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/register") ? { signup_id: "browser-signup", code_shown: "123456" } : { token: "owner-session", user: { name: "Owner", email: "owner@example.com" } }
  ), { status: url.endsWith("/register") ? 202 : 201 })));
  render(<MemoryRouter initialEntries={["/owner/sign-up"]}><Routes>
    <Route path="/owner/sign-up" element={<OwnerSignUpPage />} />
    <Route path="/owner" element={<h1>My restaurants</h1>} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Owen" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long safe password" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
  await screen.findByLabelText("Code");
  expect(getSessionToken()).toBeNull();
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
  await screen.findByRole("heading", { name: "My restaurants" });
  expect(getSessionToken()).toBe("owner-session");
});

it("says what is wrong beside each field, summarises it, and keeps the rest when one is fixed", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter initialEntries={["/owner/sign-up"]}><Routes><Route path="/owner/sign-up" element={<OwnerSignUpPage />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
  expect(fetcher).not.toHaveBeenCalled();
  // Each problem is said twice: beside its field, and in the box above the form, which takes focus.
  expect((await screen.findAllByText("Enter your first name.")).length).toBe(2);
  expect(screen.getAllByText("Enter your email address.").length).toBe(2);
  expect(screen.getByText("There are 5 problems")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  // Fixing one field keeps what was typed elsewhere.
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("owner@example.com");
  expect(screen.queryAllByText("Enter your email address.")).toHaveLength(0);
});
