import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { SignUpForm } from "./SignUpForm";
import type { CodeSentInfo, SignUpInput, VerifyInput } from "./useSignUp";
import { joinName, validateSignUp } from "./validate";

afterEach(() => vi.useRealTimers());

interface Extra {
  accessible: boolean;
}

function setup(overrides: { register?: (input: SignUpInput<Extra>) => Promise<CodeSentInfo>; verify?: (input: VerifyInput) => Promise<string> } = {}) {
  let n = 0;
  const register = vi.fn(overrides.register ?? (async () => ({ signupId: `s${++n}`, sentTo: "ni***@example.com" })));
  const verify = vi.fn(overrides.verify ?? (async () => "verified"));
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <SignUpForm<string, Extra>
        idPrefix="t"
        copy={{ title: "Create your account", lede: "A short line." }}
        initialExtra={{ accessible: false }}
        register={register}
        verify={verify}
        onDone={onDone}
        renderExtra={(extra, setExtra) => (
          <label>
            <input type="checkbox" checked={extra.accessible} onChange={(e) => setExtra({ accessible: e.target.checked })} />
            Extra: accessible
          </label>
        )}
        links={<a href="/sign-in">Already have an account? Sign in</a>}
      />
    </MemoryRouter>,
  );
  return { register, verify, onDone };
}

function fill(first = "  Nina ", last = " Lopes  ", password = "a long password"): void {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: first } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: last } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: " nina@example.com " } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree that SeatPlan stores my details/ }));
}

const send = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
};

describe("SignUpForm: the full set", () => {
  it("has every piece, on the form step and behind it", async () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeTruthy();
    expect(screen.getByLabelText("First name")).toBeTruthy();
    expect(screen.getByLabelText("Last name")).toBeTruthy();
    expect(screen.getByLabelText(/^Email/).getAttribute("type")).toBe("email");
    expect(screen.getByText("We email you a code to check it is yours.")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password");
    expect(screen.getByText("At least 10 characters.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /\(required\)/ })).toBeTruthy();
    expect(screen.getByText("What we store")).toBeTruthy();
    // Party booking stores an age for every seat: the privacy text says who sees it.
    expect(screen.getByText(/These ages are seen only by the event's organiser/)).toBeTruthy();
    expect(screen.getByLabelText(/Extra: accessible/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Already have an account? Sign in" })).toBeTruthy();

    fill();
    send();
    const code = await screen.findByLabelText("Code");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByRole("button", { name: "Create my account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send a new code/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use a different email" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Already have an account? Sign in" })).toBeTruthy();
    expect(screen.getByText("ni***@example.com")).toBeTruthy();
  });

  it("puts the eye inside the field: it flips the type and says what it will do next", () => {
    setup();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(input.parentElement?.contains(eye)).toBe(true);
    expect(eye.getAttribute("aria-controls")).toBe(input.id);
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(input, { target: { value: "Secret-Pass-1" } });
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    expect(input.value).toBe("Secret-Pass-1");
    expect(eye.getAttribute("aria-label")).toBe("Hide password");
    expect(eye.getAttribute("aria-pressed")).toBe("true");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    fireEvent.click(eye);
    expect(input.type).toBe("password");
    expect(eye.getAttribute("aria-label")).toBe("Show password");
  });
});

describe("SignUpForm: nameHint", () => {
  it("shows who sees the name when a page asks for it", () => {
    render(
      <MemoryRouter>
        <SignUpForm<string>
          idPrefix="h"
          copy={{ title: "Create your account" }}
          nameHint="The organiser sees your name."
          register={async () => ({ signupId: "s1" })}
          verify={async () => "ok"}
          onDone={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("The organiser sees your name.")).toBeTruthy();
  });
});

describe("SignUpForm: what is sent", () => {
  it("joins first and last name for the endpoints that take one name, trimmed", async () => {
    const { register } = setup();
    fill();
    fireEvent.click(screen.getByLabelText(/Extra: accessible/));
    send();
    await screen.findByLabelText("Code");
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0]).toEqual({
      firstName: "Nina",
      lastName: "Lopes",
      name: "Nina Lopes",
      email: "nina@example.com",
      password: "a long password",
      extra: { accessible: true },
    });
  });

  it("sends nothing and lists every problem when the form is empty", () => {
    const { register } = setup();
    send();
    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(within(alert).getByText("There are 5 problems")).toBeTruthy();
    for (const text of ["Enter your first name.", "Enter your last name.", "Enter your email address.", "Use at least 10 characters."]) {
      expect(within(alert).getByText(text)).toBeTruthy();
    }
    expect(within(alert).getByText(/Tick the box to agree/)).toBeTruthy();
    expect(screen.getByLabelText("First name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /I agree/ }).getAttribute("aria-describedby")).toBe("t-consent-error");
    expect(register).not.toHaveBeenCalled();
  });

  it("puts a server message that names a field (even the old single 'name') beside that field", async () => {
    setup({ register: async () => Promise.reject(new ApiError(422, "validation", "name: Use your real name.")) });
    fill();
    send();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("First name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText("Use your real name.").length).toBeGreaterThan(0);
  });
});

describe("SignUpForm: the code step", () => {
  it("asks for six digits before calling verify, then verifies with the code and the signup id", async () => {
    const { verify, onDone } = setup();
    fill();
    send();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "12ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect(screen.getAllByText("Enter the 6 digits from the email.").length).toBeGreaterThan(0);
    expect(verify).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("verified"));
    expect(verify).toHaveBeenCalledWith({ email: "nina@example.com", code: "123456", signupId: "s1", password: "a long password" });
  });

  it("sends a new code after the wait and verifies with the NEWEST signup_id", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { register, verify } = setup();
    fill();
    send();
    const waiting = await screen.findByRole("button", { name: /Send a new code in 30 s/ });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(31_000);
    const again = await screen.findByRole("button", { name: "Send a new code" });
    expect((again as HTMLButtonElement).disabled).toBe(false);
    // The end of the wait is announced once, so a screen reader hears that a new code can be asked for.
    expect(screen.getByRole("status").textContent).toBe("You can ask for a new code now.");
    fireEvent.click(again);
    await screen.findByText(/^We sent a new code\. Only the newest one works\./);
    expect(register).toHaveBeenCalledTimes(2);
    // Same payload again: the password stayed in memory for exactly this.
    expect(register.mock.calls[1][0]).toEqual(register.mock.calls[0][0]);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify.mock.calls[0][0].signupId).toBe("s2");
  });

  it("does not verify the old code while a new one is on its way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    let release: (info: CodeSentInfo) => void = () => undefined;
    const { verify } = setup({
      register: () => {
        n += 1;
        if (n === 1) return Promise.resolve({ signupId: "s1" });
        return new Promise<CodeSentInfo>((resolve) => {
          release = resolve;
        });
      },
    });
    fill();
    send();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "123456" } });
    await vi.advanceTimersByTimeAsync(31_000);
    fireEvent.click(await screen.findByRole("button", { name: "Send a new code" }));
    // The second register call is still open: submitting now would send the old code with a retiring id.
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect(verify).not.toHaveBeenCalled();
    release({ signupId: "s2" });
    await screen.findByText(/^We sent a new code/);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify.mock.calls[0][0].signupId).toBe("s2");
  });

  it("goes back to the form for a different email: every field kept, the password cleared", async () => {
    setup();
    fill();
    fireEvent.click(screen.getByLabelText(/Extra: accessible/));
    send();
    fireEvent.click(await screen.findByRole("button", { name: "Use a different email" }));
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("  Nina ");
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe(" Lopes  ");
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe("nina@example.com");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/Extra: accessible/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /I agree/ }) as HTMLInputElement).checked).toBe(true);
    // The heading takes focus, so a screen reader hears the step change.
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Create your account" }));
  });

  it("shows a wrong code next to the code field and keeps the person on the step", async () => {
    setup({ verify: async () => Promise.reject(new ApiError(422, "validation", "That code is not right. You have 4 tries left.")) });
    fill();
    send();
    fireEvent.change(await screen.findByLabelText("Code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect(await screen.findAllByText("That code is not right. You have 4 tries left.")).toHaveLength(2); // box and field
    expect(screen.getByLabelText("Code").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("validateSignUp and joinName", () => {
  const good = { firstName: "Nina", lastName: "Lopes", email: "nina@example.com", password: "0123456789", consent: true };

  it("accepts a complete form with a 10-character password", () => {
    expect(Object.values(validateSignUp(good)).filter(Boolean)).toEqual([]);
  });

  it("refuses 9 characters, a password equal to the email, a missing name part and no consent", () => {
    expect(validateSignUp({ ...good, password: "012345678" }).password).toBe("Use at least 10 characters.");
    expect(validateSignUp({ ...good, password: "Nina@Example.com" }).password).toBe("Choose a password that is not your email address.");
    expect(validateSignUp({ ...good, firstName: " " }).firstName).toBe("Enter your first name.");
    expect(validateSignUp({ ...good, lastName: "" }).lastName).toBe("Enter your last name.");
    expect(validateSignUp({ ...good, consent: false }).consent).toMatch(/Tick the box/);
  });

  it("joins the name with one space", () => {
    expect(joinName(" Nina ", " Lopes ")).toBe("Nina Lopes");
  });
});
