// The light preview says so when there is nothing to preview: the sun has set before the visit starts.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LightCursorControl, sunSetBeforeStay } from "../LightCursor";

const steps = ["20:00", "20:15", "20:30", "20:45"];
const props = { steps, index: 0, onChange: () => undefined, failed: false, bookingTime: "20:00" };

describe("Light preview when it is already dark", () => {
  it("knows the sun set before the stay", () => {
    expect(sunSetBeforeStay(steps, "17:21")).toBe(true);
    expect(sunSetBeforeStay(steps, "20:00")).toBe(true);
    expect(sunSetBeforeStay(steps, "20:30")).toBe(false);
    expect(sunSetBeforeStay(steps, null)).toBe(false);
  });

  it("shows words instead of a slider that cannot change anything", () => {
    render(<LightCursorControl {...props} sunset="17:21" />);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText(/The sun sets at 17:21, before your table time of 20:00/)).toBeTruthy();
  });

  it("keeps the slider and names the table's light when the sun is still up", () => {
    render(<LightCursorControl {...props} sunset="20:30" tableLabel="R1" summary="In the sun" />);
    expect(screen.getByRole("slider", { name: "Preview light (does not change your booking)" })).toBeTruthy();
    expect(screen.getByText(/Table R1: in the sun\./)).toBeTruthy();
  });
});
