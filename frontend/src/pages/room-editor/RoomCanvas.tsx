import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../../design/components";
import { usePanZoom } from "../../seatmap/usePanZoom";
import { outlinePath, outlineToPolygon, sidePath } from "./geometry";
import { surroundingBands } from "./surroundings";
import { terraceCorners, terraceRotation } from "./terraceGeometry";

const RULER_TOP = 20, RULER_SIDE = 40; // the strip of metre marks, in pixels
import type { Point } from "./geometry";
import { snappedPoint } from "./shapeModel";
import type { Room } from "./roomModel";
import { ShapeHandles } from "./ShapeHandles";
import type { ShapeSelection } from "./ShapeTools";
import { WallLayer } from "./WallLayer";
import { NorthCompass } from "./NorthCompass";
import { ObjectLayer } from "./ObjectLayer";
import { OBJECT_DRAG_TYPE } from "./ObjectFields";
import { TableLayer } from "./TableLayer";
import { tablesInBox } from "./selection";
import type { RoomProblem } from "./validation";

interface Props {
  room: Room; drawing: boolean; grid: boolean; fixtureGrid: boolean; onPoint: (point: Point) => void; onCloseShape: () => void;
  selection: ShapeSelection; onSelect: (selection: ShapeSelection) => void;
  onChange: (room: Room, transient?: boolean) => void; onDragStart: () => void; onError: (message: string) => void;
  tool: string; opening: string | null; onOpening: (key: string) => void;
  placement: string | null; object: string | null; onObject: (key: string | null) => void; onPlace: (point: Point, kind: string) => void;
  chair: string | null; onTableSelect: (key: string, chair: string | null, multiple?: boolean, long?: boolean) => void;
  tableKeys: string[]; multiple: boolean; areaMode: boolean; onArea: (keys: string[]) => void;
  problems: RoomProblem[]; focusTarget: { roomKey: string; point: Point; serial: number } | null;
}

export function RoomCanvas({ room, drawing, grid, fixtureGrid, onPoint, onCloseShape, selection, onSelect, onChange, onDragStart, onError, tool, opening, onOpening, placement, object, onObject, onPlace, chair, onTableSelect, tableKeys, multiple, areaMode, onArea, problems, focusTarget }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const patternId = useId();
  const [cursor, setCursor] = useState<Point | null>(null);
  const areaDrag = useRef<{ start: Point; now: Point } | null>(null), suppressClick = useRef(false);
  const [areaBox, setAreaBox] = useState<{ start: Point; now: Point } | null>(null);
  const points = room.outline.points;
  let boundsPoints: Point[] = points;
  try { if (points.length >= 3) boundsPoints = outlineToPolygon(room.outline); } catch { /* Keep invalid drafts repairable. */ }
  const bands = useMemo(() => surroundingBands(room), [room]);
  // The view takes in what lies outside the walls (a terrace, what is around the room) as well as the walls themselves.
  const reach = [...boundsPoints, ...bands.flatMap(b => b.quad), ...room.zones.flatMap(z => z.kind === "terrace" ? terraceCorners(room, z) : [{ x: z.x, y: z.y }, { x: z.x + z.w, y: z.y + z.h }])];
  const maxX = Math.max(drawing || !points.length ? 1000 : 100, ...reach.map(p => p.x));
  const maxY = Math.max(drawing || !points.length ? 700 : 100, ...reach.map(p => p.y));
  const margin = 100;
  const pan = usePanZoom(viewport, { minX: Math.min(0, ...reach.map(p => p.x)) - margin, minY: Math.min(0, ...reach.map(p => p.y)) - margin, maxX: maxX + margin, maxY: maxY + margin + 80 }); // the extra 80 cm at the bottom keeps the plan clear of the zoom buttons
  useEffect(() => { if (focusTarget?.roomKey === room.key) { pan.focusOn(focusTarget.point.x, focusTarget.point.y, 0.75); viewport.current?.scrollIntoView({ block: "center" }); } }, [focusTarget, room.key, pan.focusOn]);
  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const bounds = viewport.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left - pan.view.x) / pan.view.k, y: (event.clientY - bounds.top - pan.view.y) / pan.view.k };
  };
  const screenPoint = (event: { clientX: number; clientY: number; shiftKey: boolean }) => snappedPoint(toWorld(event), points.at(-1) ?? null, grid, event.shiftKey);
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (areaDrag.current) { areaDrag.current = { ...areaDrag.current, now: toWorld(event) }; setAreaBox(areaDrag.current); return; }
    pan.pointerHandlers.onPointerMove(event); if (drawing) setCursor(screenPoint(event));
  };
  // The metre marks live on a strip along the top and left edge of the view, not on the plan, so they never lie on a shape.
  // They are as far apart as the zoom allows: every metre when close, every 2, 5, 10... when far.
  const rulerStep = [1, 2, 5, 10, 20, 50].find(m => m * 100 * pan.view.k >= 56) ?? 100;
  // 0 m is where the room starts (its top-left corner); there are no marks before it.
  const originX = boundsPoints.length ? Math.min(...boundsPoints.map(p => p.x)) : 0, originY = boundsPoints.length ? Math.min(...boundsPoints.map(p => p.y)) : 0;
  const ticks = (length: number, offset: number, origin: number) => {
    const out: { m: number; at: number }[] = [], size = rulerStep * 100;
    for (let i = 0; offset + (origin + i * size) * pan.view.k <= length; i++) out.push({ m: i * rulerStep, at: offset + (origin + i * size) * pan.view.k });
    return out;
  };
  const rulerX = ticks(viewport.current?.clientWidth ?? 1400, pan.view.x, originX).filter(t => t.at >= RULER_SIDE + 14), rulerY = ticks(viewport.current?.clientHeight ?? 900, pan.view.y, originY).filter(t => t.at >= RULER_TOP + 8);
  return <div className="room-canvas-wrap">
    <div ref={viewport} className="room-canvas" tabIndex={0} role="region" aria-label="Room plan" {...pan.pointerHandlers} onPointerDown={event => {
      if (tool === "Tables" && !placement && (areaMode || event.shiftKey)) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const start = toWorld(event); areaDrag.current = { start, now: start }; setAreaBox(areaDrag.current); }
      else pan.pointerHandlers.onPointerDown(event);
    }} onPointerUp={event => {
      if (areaDrag.current) { onArea(tablesInBox(room, areaDrag.current.start, toWorld(event))); areaDrag.current = null; setAreaBox(null); suppressClick.current = true; }
      else pan.pointerHandlers.onPointerUp(event);
    }} onPointerCancel={event => { areaDrag.current = null; setAreaBox(null); pan.pointerHandlers.onPointerCancel(event); }} onPointerMove={move} onDragOver={event => { if (event.dataTransfer.types.includes(OBJECT_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={event => { const kind = event.dataTransfer.getData(OBJECT_DRAG_TYPE); if (kind) { event.preventDefault(); onPlace(/^(fixture|zone|table):/.test(kind) ? toWorld(event) : snappedPoint(toWorld(event), null, grid, false), kind); } }} onClick={event => {
      if (suppressClick.current) { suppressClick.current = false; return; }
      if (placement && !pan.wasDragged()) { onPlace(/^(fixture|zone|table):/.test(placement) ? toWorld(event) : snappedPoint(toWorld(event), null, grid, false), placement); return; }
      if (!drawing && !pan.wasDragged() && tool === "Fixed") { onObject(null); return; } // a click on empty floor lets go of the element
      if (!drawing || pan.wasDragged()) return;
      const point = screenPoint(event);
      if (points.length >= 3 && Math.hypot(point.x - points[0].x, point.y - points[0].y) * pan.view.k < 24) onCloseShape();
      else onPoint(point);
    }}>
      <svg width="100%" height="100%" aria-hidden="true">
        <defs>
          <pattern id={patternId} width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" className="room-grid-line" /></pattern>
          <pattern id={`${patternId}-check`} width="100" height="100" patternUnits="userSpaceOnUse"><rect width="50" height="50" className="room-checker-cell" /><rect x="50" y="50" width="50" height="50" className="room-checker-cell" /></pattern>
          <pattern id={`${patternId}-water`} width="40" height="20" patternUnits="userSpaceOnUse"><path d="M 0 10 Q 10 0 20 10 T 40 10" className="room-view-wave" /></pattern>
          <pattern id={`${patternId}-green`} width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="4" className="room-view-tree" /><circle cx="27" cy="27" r="4" className="room-view-tree" /></pattern>
          {points.length >= 3 && <clipPath id={`${patternId}-room`}><path d={outlinePath(room.outline)} /></clipPath>}
        </defs>
        <g transform={`translate(${pan.view.x} ${pan.view.y}) scale(${pan.view.k})`}>
          <rect x="-10000" y="-10000" width="20000" height="20000" fill={grid ? `url(#${patternId})` : "transparent"} />
          {!drawing && bands.map(b => <g key={`view${b.side}`} className={`room-view room-view-${b.surrounding.group}`} data-room-view={b.surrounding.kind} pointerEvents="none">
            <polygon points={b.quad.map(p => `${p.x},${p.y}`).join(" ")} />
            {b.surrounding.group !== "other" && <polygon points={b.quad.map(p => `${p.x},${p.y}`).join(" ")} fill={`url(#${patternId}-${b.surrounding.group})`} />}
            <text x={b.label.x} y={b.label.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(13 / pan.view.k, 15)}>{b.surrounding.label}</text>
          </g>)}
          {!drawing && points.length >= 3 && <path d={outlinePath(room.outline)} className={problems.some(p => p.code === "outline_invalid") ? "room-outline room-outline-invalid" : "room-outline"} />}
          {!drawing && points.length >= 3 && <rect x="-10000" y="-10000" width="20000" height="20000" fill={`url(#${patternId}-check)`} clipPath={`url(#${patternId}-room)`} pointerEvents="none" data-room-checker />}
          {drawing && <polyline points={[...points, ...(cursor ? [cursor] : [])].map(p => `${p.x},${p.y}`).join(" ")} className="room-drawing" />}
          {points.map((p, i) => <text key={i} x={p.x + 12 / pan.view.k} y={p.y - 10 / pan.view.k} fontSize={12 / pan.view.k} className="room-ruler">{i + 1}</text>)}
          {!drawing && <ObjectLayer room={room} kind="zone" rotationOf={z => terraceRotation(room, z)} only={z => tool !== "Walls" || z.kind !== "terrace"} editing={tool === "Fixed" && !placement} selected={object} grid={fixtureGrid} zoom={pan.view.k} toWorld={toWorld} onSelect={onObject} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} />}
          {!drawing && tool === "Walls" && <ObjectLayer room={room} kind="zone" rotationOf={z => terraceRotation(room, z)} only={z => z.kind === "terrace"} editing={true} selected={object} grid={fixtureGrid} zoom={pan.view.k} toWorld={toWorld} onSelect={onObject} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} />}
          {!drawing && <ObjectLayer room={room} kind="fixture" editing={tool === "Fixed" && !placement} selected={object} grid={fixtureGrid} zoom={pan.view.k} toWorld={toWorld} onSelect={onObject} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} />}
          <TableLayer room={room} editing={tool === "Tables" && !placement} selected={object} keys={tableKeys} multiple={multiple} chair={chair} grid={grid} zoom={pan.view.k} toWorld={toWorld} onSelect={onTableSelect} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} onError={onError} invalidKeys={problems.filter(p => p.level === "error").flatMap(p => p.table_keys)} />
          {areaBox && <rect x={Math.min(areaBox.start.x, areaBox.now.x)} y={Math.min(areaBox.start.y, areaBox.now.y)} width={Math.abs(areaBox.now.x - areaBox.start.x)} height={Math.abs(areaBox.now.y - areaBox.start.y)} className="room-selection-box" />}
          {!drawing && points.length >= 3 && tool === "Shape" && <ShapeHandles room={room} zoom={pan.view.k} grid={grid} selection={selection} toWorld={toWorld} onSelect={onSelect} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} onError={onError} />}
          {!drawing && tool === "Walls" && points.map((_, i) => <path key={`select-${i}`} d={sidePath(room.outline, i)} className="room-wall-hit" strokeWidth={44 / pan.view.k} onPointerDown={event => { event.stopPropagation(); onSelect({ kind: "side", index: i }); }} />)}
          {!drawing && <WallLayer room={room} zoom={pan.view.k} editing={tool === "Walls"} selected={opening} toWorld={toWorld} onSelect={onOpening} onChange={onChange} onDragStart={() => { pan.zoomBy(1); onDragStart(); }} onError={onError} />}
        </g>
        <g className="room-rulers" pointerEvents="none" aria-hidden="true">
          <rect x="0" y="0" width="100%" height={RULER_TOP} className="room-ruler-bg" /><rect x="0" y="0" width={RULER_SIDE} height="100%" className="room-ruler-bg" />
          {rulerX.map(t => <g key={`x${t.m}`}><line x1={t.at} y1={RULER_TOP - 5} x2={t.at} y2={RULER_TOP} className="room-ruler-tick" /><text x={t.at} y={RULER_TOP - 7} textAnchor="middle" fontSize="11" className="room-ruler">{t.m} m</text></g>)}
          {rulerY.map(t => <g key={`y${t.m}`}><line x1={RULER_SIDE - 5} y1={t.at} x2={RULER_SIDE} y2={t.at} className="room-ruler-tick" /><text x={RULER_SIDE - 8} y={t.at} textAnchor="end" dominantBaseline="central" fontSize="11" className="room-ruler">{t.m} m</text></g>)}
        </g>
      </svg>
    </div>
    <NorthCompass />
    <div className="room-zoom"><Button variant="secondary" aria-label="Zoom out" onClick={() => pan.zoomBy(0.8)}>−</Button><Button variant="secondary" onClick={pan.fit}>Fit room</Button><Button variant="secondary" aria-label="Zoom in" onClick={() => pan.zoomBy(1.25)}>+</Button></div>
  </div>;
}
