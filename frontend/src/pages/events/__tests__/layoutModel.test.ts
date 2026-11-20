import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api/client";
import type { LayoutPreview } from "../../../api/events";
import { appliedMessage, capacityFit, confirmFacts, confirmLines, currentLine, previewToMap, thumbTransform } from "../layoutModel";

const PREVIEW: LayoutPreview = {
  width: 1000,
  height: 500,
  zones: [{ kind: "stage", x: 300, y: 20, w: 400, h: 80 }],
  tables: [
    { shape: "round", x: 100, y: 200, w: 120, h: 120, rotation: 0, seats: [{ x: 160, y: 180 }, { x: 160, y: 340 }] },
    { shape: "row", x: 500, y: 200, w: 300, h: 40, rotation: 90, seats: [{ x: 530, y: 220 }] },
  ],
};

describe("previewToMap", () => {
  it("gives every table and seat its own id and keeps the geometry", () => {
    const map = previewToMap(PREVIEW);
    expect(map.tables.map((t) => t.id)).toEqual([1, 2]);
    expect(map.tables[1]).toMatchObject({ shape: "row", x: 500, y: 200, w: 300, h: 40, rotation: 90, label: "2" });
    expect(map.seats.map((s) => [s.id, s.table_id, s.x, s.y])).toEqual([
      [1, 1, 160, 180],
      [2, 1, 160, 340],
      [3, 2, 530, 220],
    ]);
  });

  it("draws every seat free and nobody on it: a preview has no guests yet", () => {
    const map = previewToMap(PREVIEW);
    expect(map.seats.every((s) => s.state === "free" && s.occupant === null && !s.accessible)).toBe(true);
    expect(map.seats.map((s) => s.label)).toEqual(["1", "2", "1"]);
  });

  it("names the zones the map knows and turns unknown kinds into general ones", () => {
    const map = previewToMap({ ...PREVIEW, zones: [...PREVIEW.zones, { kind: "dance", x: 0, y: 0, w: 10, h: 10 }] });
    expect(map.zones.map((z) => [z.id, z.kind])).toEqual([
      [1, "stage"],
      [2, "general"],
    ]);
  });
});

describe("previewToMap zone names", () => {
  it("names the front zone as the setup does: dance floor, screen, bar or stage", () => {
    expect(previewToMap(PREVIEW, "banquet").zones[0].name).toBe("Dance floor");
    expect(previewToMap(PREVIEW, "u_shape").zones[0].name).toBe("Screen");
    expect(previewToMap(PREVIEW, "theatre").zones[0].name).toBe("Stage");
    expect(previewToMap({ ...PREVIEW, zones: [{ kind: "bar", x: 0, y: 0, w: 9, h: 9 }] }, "cocktail").zones[0].name).toBe("Bar");
  });
});

describe("thumbTransform", () => {
  it("is empty without a rotation and turns around the box centre otherwise", () => {
    expect(thumbTransform({ x: 10, y: 20, w: 100, h: 40, rotation: 0 })).toBeUndefined();
    expect(thumbTransform({ x: 10, y: 20, w: 100, h: 40, rotation: 90 })).toBe("rotate(90 60 40)");
  });
});

describe("capacityFit", () => {
  it("says when a setup does not fit the room at all", () => {
    expect(capacityFit(0, 40)).toEqual({ tone: "none", text: "Does not fit this room" });
  });

  it("counts the guests left over when there are too few seats", () => {
    expect(capacityFit(30, 40)).toEqual({ tone: "short", text: "30 seats for 40 coming, 10 short" });
  });

  it("is fine when everyone coming fits", () => {
    expect(capacityFit(140, 40)).toEqual({ tone: "ok", text: "140 seats for 40 coming" });
    expect(capacityFit(1, 1)).toEqual({ tone: "ok", text: "1 seat for 1 coming" });
  });
});

describe("confirmFacts", () => {
  const details = { seated: 22, capacity: 140, guests: 40 };

  it("reads the counts the server puts under error.details for the two confirm answers", () => {
    const body = { code: "guests_seated", message: "x", details };
    expect(confirmFacts(new ApiError(409, "guests_seated", "x", body))).toEqual(details);
    expect(confirmFacts(new ApiError(422, "not_enough_seats", "x", { ...body, code: "not_enough_seats" }))).toEqual(details);
  });

  it("is null for any other error, or when the counts are missing", () => {
    expect(confirmFacts(new ApiError(422, "too_small", "x", { code: "too_small", message: "x" }))).toBeNull();
    expect(confirmFacts(new ApiError(409, "guests_seated", "x", { code: "guests_seated", message: "x" }))).toBeNull();
    expect(confirmFacts(new ApiError(409, "conflict", "x", { code: "conflict", message: "x", details }))).toBeNull();
    expect(confirmFacts(new Error("boom"))).toBeNull();
  });
});

describe("confirmLines", () => {
  it("says who is re-seated and that seat changes are emailed", () => {
    expect(confirmLines("Theatre", { seated: 22, capacity: 140, guests: 40 })).toEqual([
      "22 guests already have a seat. They will be re-seated automatically on the Theatre setup, keeping groups and friends together.",
      "Anyone whose seat changes gets the usual seat-change email.",
    ]);
  });

  it("warns when seated guests will lose their seat", () => {
    expect(confirmLines("Boardroom", { seated: 22, capacity: 20, guests: 40 })).toEqual([
      "22 guests already have a seat. They will be re-seated automatically on the Boardroom setup, keeping groups and friends together.",
      "The Boardroom setup has only 20 seats, so 2 guests will lose their seat and be told by email.",
      "Anyone whose seat changes gets the usual seat-change email.",
    ]);
  });

  it("warns when the setup has fewer seats than guests coming, even with nobody seated", () => {
    expect(confirmLines("Boardroom", { seated: 0, capacity: 30, guests: 40 })).toEqual([
      "The Boardroom setup has 30 seats for 40 guests coming, so 10 will not get a seat.",
    ]);
    expect(confirmLines("Boardroom", { seated: 1, capacity: 30, guests: 31 })).toEqual([
      "1 guest already has a seat. They will be re-seated automatically on the Boardroom setup, keeping groups and friends together.",
      "The Boardroom setup has 30 seats for 31 guests coming, so 1 will not get a seat.",
      "Anyone whose seat changes gets the usual seat-change email.",
    ]);
  });

  it("names seated guests who need a step-free seat the setup does not have", () => {
    const facts = { seated: 7, capacity: 30, guests: 7, accessible_needed: 6, accessible_seats: 4, holding: 0 };
    expect(confirmLines("Banquet", facts)).toEqual([
      "7 guests already have a seat. They will be re-seated automatically on the Banquet setup, keeping groups and friends together.",
      "Only 4 seats in the Banquet setup are step-free, so at least 2 guests who need one will lose their seat and be told by email.",
      "Anyone whose seat changes gets the usual seat-change email.",
    ]);
    expect(confirmLines("Classroom", { ...facts, accessible_needed: 1, accessible_seats: 0 })[1]).toBe(
      "No seat in the Classroom setup is step-free, so at least 1 guest who needs one will lose their seat and be told by email.",
    );
    expect(confirmLines("Banquet", { ...facts, accessible_needed: 4 })).toHaveLength(2);
  });

  it("says that people choosing a seat right now will choose again", () => {
    const lines = confirmLines("Theatre", { seated: 2, capacity: 28, guests: 4, holding: 1 });
    expect(lines).toContain("1 person choosing a seat right now will need to choose again on the new layout.");
    expect(confirmLines("Theatre", { seated: 2, capacity: 28, guests: 4, holding: 3 })).toContain(
      "3 people choosing a seat right now will need to choose again on the new layout.",
    );
  });
});

describe("confirmFacts with the step-free and hold counts", () => {
  it("keeps them when the server sends them", () => {
    const details = { seated: 7, capacity: 30, guests: 7, accessible_needed: 6, accessible_seats: 4, holding: 1 };
    const body = { code: "guests_seated", message: "x", details };
    expect(confirmFacts(new ApiError(409, "guests_seated", "x", body))).toEqual(details);
  });
});

describe("previewToMap step-free seats", () => {
  it("marks the seats the preview marks", () => {
    const marked: LayoutPreview = { ...PREVIEW, tables: [{ ...PREVIEW.tables[0], seats: [{ x: 1, y: 2, accessible: true }, { x: 3, y: 4 }] }] };
    expect(previewToMap(marked).seats.map((s) => s.accessible)).toEqual([true, false]);
  });
});

describe("appliedMessage", () => {
  it("says how many were re-seated and how many lost their seat", () => {
    expect(appliedMessage("Theatre", 22, 0)).toBe("Theatre setup applied. 22 guests re-seated.");
    expect(appliedMessage("Boardroom", 20, 2)).toBe("Boardroom setup applied. 20 guests re-seated. 2 guests lost their seat and were told by email.");
    expect(appliedMessage("Cocktail", 0, 0)).toBe("Cocktail setup applied. Nobody had a seat yet.");
    expect(appliedMessage("Cabaret", 1, 1)).toBe("Cabaret setup applied. 1 guest re-seated. 1 guest lost their seat and was told by email.");
  });
});

describe("currentLine", () => {
  const labels = { banquet: "Banquet", theatre: "Theatre" };

  it("names the setup in use with its seats", () => {
    expect(currentLine({ current: "banquet", own_layout: true, capacity: 80 }, labels)).toBe("Banquet setup, 80 seats");
  });

  it("tells a hand-edited copy from the hall's own plan", () => {
    expect(currentLine({ current: "custom", own_layout: true, capacity: 78 }, labels)).toBe("Your own layout, 78 seats");
    expect(currentLine({ current: "custom", own_layout: false, capacity: 80 }, labels)).toBe("The venue's standard plan, 80 seats");
  });
});
