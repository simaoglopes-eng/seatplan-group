// FloorPlan: the diner's picture of one room of the restaurant, big enough to choose from.
// One room at a time (the room chips above it switch), flat and quiet: a pale floor, soft tables
// with real chairs around them, and colour only for what a table is to the diner:
//   free      a white table with soft green chairs;
//   yours     green chairs, a tinted table, a tick and a soft halo;
//   not yours pale grey, nothing to read into.
// Our suggestion carries a small star. By day the sun is a warm wash on the floor; after dark the
// whole plan turns to night, with warm light at every free table. The view through a glass wall is
// a thin strip along that side ("The Tagus river").
//
// Restaurant screens only: events keep the shared SeatMap. Like SeatMap it is one listbox with a
// table per option, the arrow keys move between tables and Enter or Space chooses one, so screen
// readers and tests read it the same way. There is no zoom: the room fills the width, and on a
// phone a wide room turns a quarter so its tables stay big.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type { MapRoom, MapSeat, MapTable, MapZone } from "../../api/types";
import { describeItem } from "../../seatmap/describe";
import type { DescribeItem } from "../../seatmap/describe";
import { tableCentre } from "../../seatmap/geometry";
import { handleMapKey } from "../../seatmap/mapKeyboard";
import { fixtureName, openingPath, outlinePath, polygonPath } from "../../seatmap/roomScene";
import { entranceTags, planLayout, project, shouldTurn, viewBox } from "./floorPlanScene";
import "./floor-plan.css";

export interface FloorPlanProps {
  /** Accessible name of the plan, e.g. "Floor plan for 20:00". */
  label: string;
  /** Every table, with the state to draw already set (tablesForMap). */
  tables: MapTable[];
  seats: MapSeat[];
  rooms: MapRoom[];
  zones?: MapZone[];
  /** The room to draw. Undefined draws every room (a restaurant with one room, or none). */
  activeRoomId?: number | null;
  selectable: (id: number) => boolean;
  selectedId: number | null;
  /** Our suggestion: a small star on the table. */
  highlight: ReadonlySet<number>;
  describe?: DescribeItem;
  /** A tap on a table, Enter or Space. */
  onSelect?: (id: number) => void;
  /** The table under the pointer or the keyboard cursor, or null. */
  onActiveChange?: (id: number | null) => void;
  /** True on a phone-width screen: a wide room turns a quarter. */
  narrow?: boolean;
}

const NONE: ReadonlySet<number> = new Set();

/** CSS pixels to plan units, from the drawn width, so words keep the same size on any screen. */
function useUnitsPerPixel(ref: RefObject<SVGSVGElement>, boxWidth: number): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const read = (): void => setWidth(svg.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref]);
  return width > 0 ? boxWidth / width : Math.max(1, boxWidth / 760);
}

function Body({ table, grow = 0, className }: { table: MapTable; grow?: number; className: string }) {
  const { x, y } = tableCentre(table);
  if (table.shape === "round") return <ellipse className={className} cx={x} cy={y} rx={table.w / 2 + grow} ry={table.h / 2 + grow} />;
  const r = Math.min(14, Math.min(table.w, table.h) / 3) + grow;
  return <rect className={className} x={table.x - grow} y={table.y - grow} width={table.w + grow * 2} height={table.h + grow * 2} rx={r} />;
}

/** A chair seen from above: a soft seat and a backrest on the side away from the table. */
function Chair({ seat, centre }: { seat: MapSeat; centre: { x: number; y: number } }) {
  const dx = seat.x - centre.x;
  const dy = seat.y - centre.y;
  const angle = (Math.atan2(-dx, dy) * 180) / Math.PI;
  return (
    <g className="fp-chair" transform={`translate(${seat.x} ${seat.y}) rotate(${angle})`}>
      <rect className="fp-chair-glow" x={-13} y={-13} width={26} height={30} rx={11} />
      <rect className="fp-seat" x={-11} y={-9} width={22} height={17} rx={7} />
      <rect className="fp-back" x={-11} y={9.5} width={22} height={5} rx={2.5} />
    </g>
  );
}

export function FloorPlan(props: FloorPlanProps) {
  const { label, tables, seats, rooms, zones = [], activeRoomId, selectable, selectedId, highlight = NONE, describe, onSelect, onActiveChange, narrow = false } = props;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // One room at a time: the room on screen, its tables and their chairs.
  const shownRooms = useMemo(() => (activeRoomId === undefined ? rooms : rooms.filter((room) => room.id === activeRoomId)), [rooms, activeRoomId]);
  const shownTables = useMemo(() => (activeRoomId === undefined ? tables : tables.filter((table) => (table.room_id ?? null) === activeRoomId)), [tables, activeRoomId]);
  const seatsOf = useMemo(() => {
    const byTable = new Map<number, MapSeat[]>();
    for (const seat of seats) byTable.set(seat.table_id, [...(byTable.get(seat.table_id) ?? []), seat]);
    return byTable;
  }, [seats]);
  const shownSeats = useMemo(() => shownTables.flatMap((table) => seatsOf.get(table.id) ?? []), [shownTables, seatsOf]);
  const shownZones = activeRoomId === undefined ? zones : [];
  const { bounds, bands } = useMemo(() => planLayout(shownTables, shownSeats, shownZones, shownRooms), [shownTables, shownSeats, shownZones, shownRooms]);

  const turned = shouldTurn(bounds, narrow);
  const box = viewBox(bounds, turned);
  const u = useUnitsPerPixel(svgRef, box.w);
  const px = (size: number): number => size * u;
  const at = (x: number, y: number) => project({ x, y }, turned);
  const night = shownRooms.some((room) => room.night);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const shownId = hoverId ?? activeId;
  useEffect(() => {
    onActiveChange?.(shownId);
    // Only a change of table is news; a new callback each render is not.
  }, [shownId]);

  const choose = (tableId: number): void => {
    if (selectable(tableId)) onSelect?.(tableId);
  };
  // Arrow keys follow the screen, so on a turned plan "down" still means down the screen.
  const points = shownTables.map((table) => ({ id: table.id, ...at(tableCentre(table).x, tableCentre(table).y) }));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const handled = handleMapKey(event, {
      points,
      activeId,
      moveTo: setActiveId,
      pick: choose,
      zoomBy: () => undefined,
      fit: () => undefined,
      leave: () => viewportRef.current?.blur(),
    });
    if (handled) event.preventDefault();
  };
  const pointer = useRef(false);
  const onFocus = (): void => {
    if (pointer.current || (activeId !== null && shownTables.some((t) => t.id === activeId))) return;
    const start = shownTables.find((t) => t.id === selectedId) ?? shownTables.find((t) => highlight.has(t.id)) ?? shownTables.find((t) => selectable(t.id)) ?? shownTables[0];
    if (start) setActiveId(start.id);
  };
  const domId = (tableId: number): string => `${id}-t${tableId}`;

  const floor = (
    <g aria-hidden="true">
      {bands.map((band) => (
        <rect key={band.side} className={`fp-band fp-band-${band.kind}`} x={band.x} y={band.y} width={band.w} height={band.h} rx={10} />
      ))}
      {shownRooms.map((room) => (
        <g key={room.id ?? "room"} data-room={room.id ?? "implicit"} className={`fp-room ${room.is_outdoor ? "is-outdoor" : "is-indoor"}`}>
          <clipPath id={`${id}-clip-${room.id ?? "x"}`}>
            <path d={outlinePath(room.outline)} />
          </clipPath>
          <path className="fp-floor" d={outlinePath(room.outline)} />
          {!room.night &&
            room.sun_patches.map((patch, i) => <path key={i} className="room-sun fp-sun" d={polygonPath(patch)} clipPath={`url(#${id}-clip-${room.id ?? "x"})`} />)}
          <path className="fp-wall" d={outlinePath(room.outline)} />
          {room.openings.map((opening) => (
            <path key={opening.id} className={opening.kind === "door" ? (opening.is_main_entrance ? "fp-door is-main" : "fp-door") : "fp-glass"} d={openingPath(room.outline, opening)} />
          ))}
          {room.fixtures.map((fixture) =>
            fixture.shape === "circle" ? (
              <ellipse key={fixture.id} className="fp-fixture" cx={fixture.x + fixture.w / 2} cy={fixture.y + fixture.h / 2} rx={fixture.w / 2} ry={fixture.h / 2} />
            ) : (
              <rect
                key={fixture.id}
                className="fp-fixture"
                x={fixture.x}
                y={fixture.y}
                width={fixture.w}
                height={fixture.h}
                rx={10}
                transform={fixture.rotation ? `rotate(${fixture.rotation} ${fixture.x + fixture.w / 2} ${fixture.y + fixture.h / 2})` : undefined}
              />
            ),
          )}
        </g>
      ))}
      {night && (
        <g className="room-night fp-night">
          {shownRooms.map((room) => (
            <path key={room.id ?? "room"} d={outlinePath(room.outline)} />
          ))}
        </g>
      )}
    </g>
  );

  const tableNodes = shownTables.map((table) => {
    const c = tableCentre(table);
    const free = selectable(table.id);
    const mine = table.id === selectedId;
    const look = mine ? "is-selected" : free ? "is-free" : "is-off";
    const name = describeItem({ kind: "table", table, seats: seatsOf.get(table.id) ?? [] }, { recommended: highlight.has(table.id), selected: mine }, describe);
    return (
      <g
        key={table.id}
        id={domId(table.id)}
        role="option"
        aria-label={name}
        aria-selected={mine}
        aria-disabled={!free}
        className={`fp-table ${look} state-${table.state ?? "free"}${free ? " is-pickable" : ""}`}
        onClick={() => choose(table.id)}
        onPointerEnter={() => setHoverId(table.id)}
        onPointerLeave={() => setHoverId((current) => (current === table.id ? null : current))}
      >
        <g transform={table.rotation ? `rotate(${table.rotation} ${c.x} ${c.y})` : undefined}>
          {night && free && <circle className="fp-glow" cx={c.x} cy={c.y} r={Math.max(table.w, table.h) * 0.9} fill={`url(#${id}-glow)`} />}
          {mine && <Body table={table} grow={22} className="fp-halo" />}
          <circle className="fp-hit" cx={c.x} cy={c.y} r={Math.max(table.w, table.h) / 2 + Math.max(20, px(12))} />
          {(seatsOf.get(table.id) ?? []).map((seat) => (
            <Chair key={seat.id} seat={seat} centre={c} />
          ))}
          {table.id === activeId && <Body table={table} grow={26} className="fp-cursor" />}
          <Body table={table} className="fp-top" />
          {mine && (
            // A tick as well as the colour, so "yours" never rests on colour alone. Upright on a turned plan.
            <g className="selected-tick fp-tick" transform={`translate(${c.x + table.w / 2 - 2} ${c.y - table.h / 2 + 2})${turned ? " rotate(-90)" : ""}`}>
              <circle r={11} />
              <path d="M-5 0l3.5 3.5L5.5-4" />
            </g>
          )}
        </g>
      </g>
    );
  });

  // Words stay upright and readable on a turned plan, so they are drawn after the turn.
  const words = (
    <g className="fp-words" aria-hidden="true">
      {bands.map((band) => {
        const middle = at(band.x + band.w / 2, band.y + band.h / 2);
        const vertical = turned ? band.w > band.h : band.h > band.w;
        return (
          <text key={band.side} className="fp-band-text" x={middle.x} y={middle.y} fontSize={px(12)} transform={vertical ? `rotate(-90 ${middle.x} ${middle.y})` : undefined}>
            {band.text}
          </text>
        );
      })}
      {entranceTags(shownRooms).map((tag, i) => {
        // Where the diner walks in. Upright on a turned plan, like every other word here.
        const p = at(tag.x, tag.y);
        const w = px(100);
        const h = px(20);
        return (
          <g key={`e${i}`} className="fp-entrance">
            <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={h / 2} />
            <text x={p.x} y={p.y} fontSize={px(12)}>
              Main entrance
            </text>
          </g>
        );
      })}
      {shownRooms.length > 1 &&
        shownRooms.map((room) => {
          const xs = room.outline.points.map((p) => p.x);
          const ys = room.outline.points.map((p) => p.y);
          const a = at(Math.min(...xs), Math.min(...ys));
          const b = at(Math.max(...xs), Math.max(...ys));
          return (
            <text key={room.id ?? "room"} className="fp-room-name" x={Math.min(a.x, b.x) + px(10)} y={Math.min(a.y, b.y) + px(20)} fontSize={px(13)}>
              {room.name}
            </text>
          );
        })}
      {shownRooms.flatMap((room) =>
        room.fixtures.map((fixture) => {
          const p = at(fixture.x + fixture.w / 2, fixture.y + fixture.h / 2);
          return (
            <text key={`f${fixture.id}`} className="fp-fixture-text" x={p.x} y={p.y} fontSize={Math.min(px(11), Math.max(fixture.w, fixture.h) / 3.2)}>
              {fixtureName(fixture)}
            </text>
          );
        }),
      )}
      {shownTables.map((table) => {
        const c = tableCentre(table);
        const p = at(c.x, c.y);
        const look = table.id === selectedId ? " is-selected" : selectable(table.id) ? "" : " is-off";
        return (
          <text key={`t${table.id}`} className={`fp-code${look}`} x={p.x} y={p.y} fontSize={Math.min(px(12.5), Math.min(table.w, table.h) * 0.42)}>
            {table.label}
          </text>
        );
      })}
      {shownTables
        .filter((table) => highlight.has(table.id) && selectable(table.id))
        .slice(0, 1)
        .map((table) => {
          // Our suggestion: a small star at the corner opposite the tick.
          const corner = at(table.x, table.y);
          const r = px(10);
          return (
            <g key="pick" className="fp-pick">
              <circle cx={corner.x} cy={corner.y} r={r} />
              <path
                transform={`translate(${corner.x} ${corner.y}) scale(${r / 10})`}
                d="M0-6.2l1.8 3.8 4.1.5-3 2.9.8 4.1L0 3.1-3.7 5.1l.8-4.1-3-2.9 4.1-.5z"
              />
            </g>
          );
        })}
    </g>
  );

  return (
    <div className="fp">
      <div
        ref={viewportRef}
        className={`fp-viewport${night ? " is-night" : ""}`}
        tabIndex={0}
        role="listbox"
        aria-label={label}
        aria-roledescription="table map"
        aria-describedby={`${id}-help`}
        aria-activedescendant={activeId === null ? undefined : domId(activeId)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onPointerDownCapture={() => (pointer.current = true)}
        onKeyDownCapture={() => (pointer.current = false)}
        onBlur={() => {
          pointer.current = false;
          setActiveId(null);
        }}
      >
        <svg ref={svgRef} className="fp-svg" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
          <defs>
            <radialGradient id={`${id}-glow`}>
              <stop offset="0" className="fp-glow-in" />
              <stop offset="1" className="fp-glow-out" />
            </radialGradient>
          </defs>
          <g transform={turned ? "rotate(90)" : undefined}>
            {floor}
            {tableNodes}
          </g>
          {words}
        </svg>
      </div>
      <p id={`${id}-help`} className="visually-hidden">
        Use the arrow keys to move between tables, Enter or Space to choose one, and Escape to leave the plan.
      </p>
    </div>
  );
}
