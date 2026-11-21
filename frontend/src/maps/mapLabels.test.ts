import { describe, expect, it } from "vitest";
import { alongLine, labelStyle, placeLabels, stitch, tileCandidates } from "./mapLabels";
import type { Candidate } from "./mapLabels";
import { geometryLines } from "./vectorTile";
import type { MapLayer } from "./vectorTile";

const measure = (text: string) => text.length * 6;
const box = { x0: 0, y0: 0, x1: 400, y1: 300 };
const street = (text: string, line: { x: number; y: number }[], category = "primary"): Candidate => ({ text, style: labelStyle("transportation_name", category, 15)!, lines: [line] });

describe("what is named at each zoom", () => {
  it("names main areas, rivers, parks and streets, and only as small as the zoom allows", () => {
    expect(labelStyle("place", "suburb", 13)?.kind).toBe("area");
    expect(labelStyle("place", "neighbourhood", 12)).toBeNull();
    expect(labelStyle("place", "neighbourhood", 15)?.kind).toBe("area");
    expect(labelStyle("water_name", "lake", 11)?.kind).toBe("water");
    expect(labelStyle("waterway", "river", 12)?.kind).toBe("waterway");
    expect(labelStyle("waterway", "stream", 13)).toBeNull();
    expect(labelStyle("park", undefined, 13)).toBeNull();
    expect(labelStyle("park", undefined, 15)?.kind).toBe("park");
    expect(labelStyle("transportation_name", "primary", 12)?.kind).toBe("street");
    expect(labelStyle("transportation_name", "minor", 14)).toBeNull();
    expect(labelStyle("transportation_name", "minor", 15)?.kind).toBe("street");
    expect(labelStyle("transportation_name", "rail", 18)).toBeNull();
    expect(labelStyle("building", undefined, 16)).toBeNull();
    // Places worth finding: the most important ones first, more as the map is zoomed in; artworks never.
    expect(labelStyle("poi", "monument", 14, { rank: 2 })?.kind).toBe("place");
    expect(labelStyle("poi", "monument", 14, { rank: 9 })).toBeNull();
    expect(labelStyle("poi", "monument", 16, { rank: 9 })?.kind).toBe("place");
    expect(labelStyle("poi", "attraction", 17, { subclass: "artwork" })).toBeNull();
    expect(labelStyle("poi", "park", 14, { rank: 5 })?.kind).toBe("park");
    expect(labelStyle("poi", "museum", 13, { rank: 1 })).toBeNull();
    expect(labelStyle("poi", "restaurant", 17, { rank: 1 })).toBeNull();
  });
});

describe("tile names", () => {
  it("turns a named feature into geometry in world pixels", () => {
    const layer: MapLayer = { extent: 4096, features: [{ kind: 1, category: "suburb", name: "Chiado", geometry: Uint8Array.from([9, 0, 0]) }, { kind: 1, category: "suburb", geometry: Uint8Array.from([9, 0, 0]) }] };
    const found = tileCandidates(new Map([["place", layer]]), { x: 2, y: 1, z: 14 }, 14);
    expect(found).toHaveLength(1); // the unnamed one is skipped
    expect(found[0].text).toBe("Chiado");
    expect(found[0].lines[0][0]).toEqual({ x: 512, y: 256 }); // tile 2,1 of 256 px
    const long: MapLayer = { extent: 4096, features: [{ kind: 1, category: "monument", rank: 1, name: "Biblioteca Histórica ou Antiga da Associação dos Arqueólogos Portugueses", geometry: Uint8Array.from([9, 0, 0]) }] };
    expect(tileCandidates(new Map([["poi", long]]), { x: 0, y: 0, z: 14 }, 15)[0].text).toBe("Biblioteca Histórica ou Anti…"); // long names are cut short
    expect(geometryLines(Uint8Array.from([9, 20, 10, 10, 7, 12]), 1)).toEqual([[{ x: 10, y: 5 }, { x: 6, y: 11 }]]);
  });
});

describe("streets", () => {
  it("joins the pieces of a street that were cut where tiles meet", () => {
    const joined = stitch([[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 200, y: 0 }, { x: 100.5, y: 0 }]]);
    expect(joined).toHaveLength(1);
    expect(joined[0][0].x === 0 || joined[0][0].x === 200).toBe(true);
    expect(stitch([[{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 50, y: 50 }, { x: 60, y: 50 }]])).toHaveLength(2);
  });

  it("puts a name on the longest stretch that fits, upright, and skips a street that is too short or too bent", () => {
    const spot = alongLine([{ x: 20, y: 50 }, { x: 220, y: 50 }], 60, box)!;
    expect(Math.abs(spot.x - 120)).toBeLessThan(3); expect(spot.angle).toBe(0);
    const down = alongLine([{ x: 300, y: 20 }, { x: 100, y: 120 }], 60, box)!; // runs down-left: turned so the text is not upside down
    expect(Math.abs(down.angle)).toBeLessThanOrEqual(90);
    expect(alongLine([{ x: 20, y: 50 }, { x: 50, y: 50 }], 60, box)).toBeNull();
    expect(alongLine([{ x: 20, y: 50 }, { x: 80, y: 120 }, { x: 140, y: 50 }], 120, box)).toBeNull(); // a hairpin under the name
    expect(alongLine([{ x: -500, y: 50 }, { x: -100, y: 50 }], 60, box)).toBeNull(); // out of view
  });
});

describe("choosing names", () => {
  it("places main areas before streets, drops a name that would cover another, and does not repeat one nearby", () => {
    const area: Candidate = { text: "Chiado", style: labelStyle("place", "suburb", 14)!, lines: [[{ x: 200, y: 50 }]] };
    const over = street("Rua do Alecrim", [{ x: 150, y: 50 }, { x: 350, y: 50 }]); // runs right through the area's name
    const clear = street("Rua Garrett", [{ x: 20, y: 200 }, { x: 380, y: 200 }]);
    const placed = placeLabels([over, clear, area], box, measure);
    expect(placed.map(p => p.text)).toEqual(["CHIADO", "Rua Garrett"]);
    const twice = placeLabels([street("Rua A", [{ x: 10, y: 20 }, { x: 200, y: 20 }]), street("Rua A", [{ x: 10, y: 250 }, { x: 200, y: 250 }])], box, measure, 320);
    expect(twice).toHaveLength(1);
  });

  it("names a park at the middle of all its pieces and merges the pieces of one name", () => {
    const style = labelStyle("park", undefined, 15)!;
    const placed = placeLabels([{ text: "Jardim da Estrela", style, lines: [[{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]] }, { text: "Jardim da Estrela", style, lines: [[{ x: 200, y: 200 }, { x: 300, y: 200 }]] }], box, measure);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ x: 200, y: 150 });
  });
});
