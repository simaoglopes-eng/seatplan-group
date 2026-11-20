import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgeProfile } from "./AgeProfile";

describe("age preferences", () => {
  it("saves birth date and explicit sharing choice", () => {
    const save = vi.fn();
    render(<AgeProfile birthDate={null} shareAge={false} busy={false} onSave={save} />);
    fireEvent.click(screen.getByText("Age and privacy preferences"));
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(save).toHaveBeenCalledWith("2000-01-01", true);
  });
});
