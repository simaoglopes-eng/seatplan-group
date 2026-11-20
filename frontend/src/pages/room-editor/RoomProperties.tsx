import { Button, Select } from "../../design/components";
import { sideLength } from "./geometry";
import { insertCorner, moveCorner, removeCorner, setSideLength } from "./shapeEditing";
import type { Room } from "./roomModel";
import { RoomNumberField } from "./ShapeTools";
import type { ShapeSelection } from "./ShapeTools";

interface Props { room: Room; selection: ShapeSelection; onSelect: (selection: ShapeSelection) => void; onChange: (room: Room) => void; onError: (message: string) => void }

export function RoomProperties({ room, selection, onSelect, onChange, onError }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selection?.kind, selection?.index]);
  const points = room.outline.points;
  const apply = (change: () => Room) => { try { onChange(change()); } catch (caught) { onError(caught instanceof Error ? caught.message : "Check the wall dimensions."); } };
  const [addError, setAddError] = useState("");
  const index = selection?.index ?? -1, point = points[index];
  // A new wall splits an existing one in two: the chosen wall, or the longest when none is chosen.
  const addWall = () => {
    const chosen = selection?.kind === "side" && selection.index < points.length ? selection.index : -1;
    const longest = points.reduce((best, _, i) => sideLength(room.outline, i) > sideLength(room.outline, best) ? i : best, 0);
    const side = chosen >= 0 ? chosen : longest;
    try { onChange(insertCorner(room, side)); onSelect({ kind: "side", index: side + 1 }); setAddError(""); }
    catch (caught) { setAddError(caught instanceof Error ? caught.message : "Could not add a wall here."); }
  };
  const options = [{ value: "", label: "Choose…" }, ...points.map((_, i) => ({ value: String(i), label: String(i + 1) }))];
  return <div className="room-form">
    <Button variant="secondary" disabled={points.length >= 60} onClick={addWall}>Add a new wall</Button>
    {addError && <p role="alert" className="room-error">{addError}</p>}
    <Select label="Selected wall" value={selection?.kind === "side" && point ? String(index) : ""} options={options} onChange={e => onSelect(e.target.value === "" ? null : { kind: "side", index: Number(e.target.value) })} />
    {point && selection?.kind === "side" && <>
      <h3 ref={heading} tabIndex={-1}>Wall {index + 1}</h3>
      <RoomNumberField label="Wall length (m)" value={sideLength(room.outline, index) / 100} decimals={2} min={0.01} onCommit={length => onChange(setSideLength(room, index, length * 100))} />
    </>}
    {point && selection?.kind === "corner" && <>
      <h3 ref={heading} tabIndex={-1}>Corner {index + 1}</h3>
      <RoomNumberField label="Corner x (cm)" value={point.x} onCommit={x => onChange(moveCorner(room, index, { x, y: point.y }))} />
      <RoomNumberField label="Corner y (cm)" value={point.y} onCommit={y => onChange(moveCorner(room, index, { x: point.x, y }))} />
      <Button variant="danger" disabled={points.length <= 3} onClick={() => { apply(() => removeCorner(room, index)); onSelect(null); }}>Remove corner</Button>
    </>}
  </div>;
}
import { useEffect, useRef, useState } from "react";
