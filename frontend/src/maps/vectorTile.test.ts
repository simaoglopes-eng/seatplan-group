import { describe, expect, it } from "vitest";
import { readMapLayers, traceGeometry } from "./vectorTile";

function bytesField(field: number, bytes: number[]) {
  return [field * 8 + 2, bytes.length, ...bytes];
}

function textField(field: number, text: string) {
  return bytesField(field, [...new TextEncoder().encode(text)]);
}

const road = [
  ...bytesField(2, [0, 0]),
  24, 2,
  ...bytesField(4, [9, 20, 10, 10, 7, 12]),
];

describe("discovery vector tiles", () => {
  it("resolves road classes even when the layer dictionary follows its features", () => {
    const layer = [
      ...textField(1, "transportation"),
      ...bytesField(2, road),
      ...textField(3, "class"),
      ...bytesField(4, textField(1, "primary")),
      40, 128, 32,
      120, 2,
    ];
    const labels = textField(1, "place");
    const layers = readMapLayers(Uint8Array.from([...bytesField(3, labels), ...bytesField(3, layer)]), new Set(["transportation"]));
    expect(layers.size).toBe(1);
    expect(layers.get("transportation")).toEqual({
      extent: 4096,
      features: [{ kind: 2, category: "primary", geometry: Uint8Array.from([9, 20, 10, 10, 7, 12]) }],
    });
  });

  it("reads a name and keeps point features", () => {
    const named = [...bytesField(2, [0, 0, 1, 1]), 24, 1, ...bytesField(4, [9, 2, 4])];
    const layer = [
      ...textField(1, "place"),
      ...bytesField(2, named),
      ...textField(3, "class"), ...textField(3, "name"),
      ...bytesField(4, textField(1, "suburb")), ...bytesField(4, textField(1, "Chiado")),
    ];
    const layers = readMapLayers(Uint8Array.from(bytesField(3, layer)), new Set(["place"]));
    expect(layers.get("place")?.features).toEqual([{ kind: 1, category: "suburb", name: "Chiado", geometry: Uint8Array.from([9, 2, 4]) }]);
  });

  it("reads a numeric rank and a subclass", () => {
    const poi = [...bytesField(2, [0, 0, 1, 1, 2, 2]), 24, 1, ...bytesField(4, [9, 2, 4])];
    const layer = [
      ...textField(1, "poi"), ...bytesField(2, poi),
      ...textField(3, "class"), ...textField(3, "subclass"), ...textField(3, "rank"),
      ...bytesField(4, textField(1, "attraction")), ...bytesField(4, textField(1, "artwork")), ...bytesField(4, [40, 3]),
    ];
    const layers = readMapLayers(Uint8Array.from(bytesField(3, layer)), new Set(["poi"]));
    expect(layers.get("poi")?.features[0]).toMatchObject({ category: "attraction", subclass: "artwork", rank: 3 });
  });

  it("traces signed deltas and closes a ring without resetting its coordinate cursor", () => {
    const commands: (string | number)[][] = [];
    traceGeometry({
      moveTo: (x, y) => commands.push(["move", x, y]),
      lineTo: (x, y) => commands.push(["line", x, y]),
      closePath: () => commands.push(["close"]),
    }, Uint8Array.from([9, 20, 10, 18, 7, 12, 0, 7, 15, 9, 3, 2]), 0.5);
    expect(commands).toEqual([
      ["move", 5, 2.5], ["line", 3, 5.5], ["line", 3, 3.5], ["close"], ["move", 2, 4],
    ]);
  });

  it("rejects truncated fields and geometry", () => {
    expect(() => readMapLayers(Uint8Array.from([26, 10, 1]), new Set())).toThrow();
    const path = { moveTo() {}, lineTo() {}, closePath() {} };
    expect(() => traceGeometry(path, Uint8Array.from([9, 0]), 1)).toThrow();
  });
});
