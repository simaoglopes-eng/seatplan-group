import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Point } from "./geometry";
import type { Room, RoomFixture, RoomZone } from "./roomModel";
import { FixtureIcon } from "./FixtureIcon";
import type { IconKind } from "./FixtureIcon";
import { editFixture, editZone, FIXTURE_NAMES } from "./roomObjects";
import { snappedPoint } from "./shapeModel";

interface Props { room: Room; kind: "fixture" | "zone"; only?: (item: RoomFixture | RoomZone) => boolean; rotationOf?: (zone: RoomZone) => number; editing: boolean; selected: string | null; grid: boolean; zoom: number; toWorld: (event: { clientX: number; clientY: number }) => Point; onSelect: (key: string) => void; onChange: (room: Room, transient?: boolean) => void; onDragStart: () => void }
interface Resize { key: string; base: Room; item: RoomFixture | RoomZone; sx: number; sy: number; started: boolean }
const MIN_SIZE = 20;
// The eight grips of a selected element: the corners and the middle of each side.
const GRIPS: [number, number, string][] = [[-1, -1, "nwse-resize"], [0, -1, "ns-resize"], [1, -1, "nesw-resize"], [1, 0, "ew-resize"], [1, 1, "nwse-resize"], [0, 1, "ns-resize"], [-1, 1, "nesw-resize"], [-1, 0, "ew-resize"]];
const turn = (p: Point, degrees: number): Point => { const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };

export function ObjectLayer({ room, kind, only, rotationOf, editing, selected, grid, zoom, toWorld, onSelect, onChange, onDragStart }: Props) {
  const drag = useRef<{ key: string; base: Room; start: Point; at: Point; last: Point; started: boolean } | null>(null);
  // A grip answers only when the cursor is right on its small square, so the rest of the element stays free to drag.
  // A finger is less exact, so a touch screen gets a larger target.
  const touch = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const reach = (touch ? 22 : 6) / zoom;
  const resize = useRef<Resize | null>(null);
  const turning = useRef<{ key: string; base: Room; item: RoomFixture; started: boolean } | null>(null);
  // The grips belong to an element the owner has clicked on the plan, not to one that was merely added or picked from a list.
  const [gripped, setGripped] = useState<string | null>(null);
  useEffect(() => { if (selected !== gripped) setGripped(null); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = (kind === "fixture" ? room.fixtures : room.zones).filter(item => !only || only(item));
  // Pulling a grip: the opposite side or corner stays put, and a fixed element never leaves the room.
  const stretch = (event: PointerEvent<SVGGElement>) => {
    const r = resize.current!, f = r.item;
    event.stopPropagation();
    if (!r.started) { onDragStart(); r.started = true; }
    const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 }, world = toWorld(event);
    const angle = "rotation" in f ? f.rotation : rotationOf ? rotationOf(f) : 0; // a terrace is turned to its wall
    const local = turn({ x: world.x - centre.x, y: world.y - centre.y }, -angle);
    const size = (value: number) => Math.max(MIN_SIZE, grid ? Math.round(value / 10) * 10 : Math.round(value));
    let w = f.w, h = f.h;
    if (r.sx) w = size(r.sx > 0 ? local.x + f.w / 2 : f.w / 2 - local.x);
    if (r.sy) h = size(r.sy > 0 ? local.y + f.h / 2 : f.h / 2 - local.y);
    if ("shape" in f && f.shape === "circle") { const side = r.sx && r.sy ? Math.max(w, h) : r.sx ? w : h; w = side; h = side; }
    const shift = turn({ x: r.sx * (w - f.w) / 2, y: r.sy * (h - f.h) / 2 }, angle);
    const patch = { x: Math.round(centre.x + shift.x - w / 2), y: Math.round(centre.y + shift.y - h / 2), w, h };
    // A fixed element stays in the room; a zone (a terrace, say) may go beyond the walls.
    try { onChange("rotation" in f ? editFixture(r.base, r.key, patch) : editZone(r.base, r.key, patch), true); } catch { /* it would leave the room: keep the last size */ }
  };
  // Turning the rotation grip: the element faces the pointer, in 15 degree steps unless placement is free. It never leaves the room.
  const spin = (event: PointerEvent<SVGGElement>) => {
    const t = turning.current!, f = t.item;
    event.stopPropagation();
    if (!t.started) { onDragStart(); t.started = true; }
    const world = toWorld(event), degrees = Math.atan2(world.x - (f.x + f.w / 2), -(world.y - (f.y + f.h / 2))) * 180 / Math.PI;
    const step = grid ? 15 : 1, rotation = (((Math.round(degrees / step) * step) % 360) + 360) % 360;
    try { onChange(editFixture(t.base, t.key, { rotation }), true); } catch { /* it would leave the room: keep the last angle */ }
  };
  const move = (event: PointerEvent<SVGGElement>) => {
    if (turning.current) { spin(event); return; }
    if (resize.current) { stretch(event); return; }
    const d = drag.current; if (!d) return;
    event.stopPropagation();
    const point = toWorld(event), dx = point.x - d.start.x, dy = point.y - d.start.y;
    if (!d.started && Math.hypot(dx, dy) * zoom < 5) return;
    if (!d.started) { onDragStart(); d.started = true; }
    const next = snappedPoint({ x: d.at.x + dx, y: d.at.y + dy }, null, grid, false);
    if (kind === "zone") { onChange(editZone(d.base, d.key, next), true); return; }
    // A fixed element stays inside the room: it stops at a wall and slides along it instead of leaving.
    for (const spot of [next, { x: next.x, y: d.last.y }, { x: d.last.x, y: next.y }]) {
      try { onChange(editFixture(d.base, d.key, spot), true); d.last = spot; return; } catch { /* outside the room: try the next spot */ }
    }
  };
  return <g className={`room-${kind}-layer`} style={{ pointerEvents: editing ? "auto" : "none" }} onPointerMove={move} onPointerUp={event => { if (editing) event.stopPropagation(); drag.current = null; resize.current = null; turning.current = null; }} onPointerCancel={() => { drag.current = null; resize.current = null; turning.current = null; }} onClick={event => { if (editing) event.stopPropagation(); }}>
    {items.map(item => {
      const rotation = "rotation" in item ? item.rotation : rotationOf ? rotationOf(item) : 0;
      const label = "label" in item ? item.label || FIXTURE_NAMES[item.kind] : item.name;
      const font = Math.max(13 / zoom, 15), small = Math.min(item.w, item.h);
      // Fixed elements and the two zones an owner can add wear an icon.
      const iconKind: IconKind | null = "label" in item ? item.kind : item.kind === "terrace" || item.kind === "quiet" ? item.kind : null, icon = iconKind && small >= font * 2.6 ? Math.min(32, small * 0.45) : 0;
      return <g key={item.key} data-room-object={item.key} className={`room-${kind}${"kind" in item && kind === "zone" ? ` room-zone-${item.kind}` : ""}${selected === item.key ? " selected" : ""}`} transform={`translate(${item.x + item.w / 2} ${item.y + item.h / 2}) rotate(${rotation})`} onPointerDown={event => {
        if (!editing) return;
        event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(item.key); setGripped(item.key);
        drag.current = { key: item.key, base: room, start: toWorld(event), at: item, last: { x: item.x, y: item.y }, started: false };
      }}>
        {"shape" in item && item.shape === "circle" ? <circle r={item.w / 2} /> : <rect x={-item.w / 2} y={-item.h / 2} width={item.w} height={item.h} />}
        <g transform={`rotate(${-rotation})`}>
          {icon > 0 && iconKind && <g transform={`translate(0 ${-font * 0.7})`}><FixtureIcon kind={iconKind} size={icon} /></g>}
          <text textAnchor="middle" dominantBaseline="middle" y={icon > 0 ? font * 0.8 : 0} fontSize={font}>{label}</text>
        </g>
        {editing && selected === item.key && gripped === item.key && GRIPS.map(([sx, sy, cursor]) => <g key={`${sx}${sy}`} data-fixture-grip={`${sx},${sy}`} transform={`translate(${sx * item.w / 2} ${sy * item.h / 2})`} style={{ cursor }}
          onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(item.key); resize.current = { key: item.key, base: room, item, sx, sy, started: false }; }}>
          <circle r={reach} className="room-handle-hit" /><rect x={-4 / zoom} y={-4 / zoom} width={8 / zoom} height={8 / zoom} className="room-handle" />
        </g>)}
        {kind === "fixture" && editing && selected === item.key && gripped === item.key && "label" in item && <g data-fixture-rotate="" style={{ cursor: "grab" }}
          onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(item.key); turning.current = { key: item.key, base: room, item, started: false }; }}>
          <line x1={0} y1={-item.h / 2} x2={0} y2={-item.h / 2 - 28 / zoom} className="room-rotate-stem" />
          <circle cx={0} cy={-item.h / 2 - 28 / zoom} r={reach} className="room-handle-hit" />
          <circle cx={0} cy={-item.h / 2 - 28 / zoom} r={5 / zoom} className="room-handle" />
        </g>}
      </g>;
    })}
  </g>;
}
