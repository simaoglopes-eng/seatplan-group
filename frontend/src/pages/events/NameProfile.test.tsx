import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NameProfile } from "./NameProfile";

describe("event name preferences", () => {
  it("lets a participant set separate names", () => {
    const save = vi.fn();
    render(<NameProfile firstName="" lastName="" currentName="Existing Name" busy={false} onSave={save} />);
    fireEvent.click(screen.getByText("Your name for this event"));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Silva" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(save).toHaveBeenCalledWith("Maria", "Silva");
  });
});
