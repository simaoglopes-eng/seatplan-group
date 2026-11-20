import { useState } from "react";
import { Button, Checkbox, Select } from "../../design/components";
import { sideLength } from "./geometry";
import type { Room, RoomOpening } from "./roomModel";
import { RoomNumberField } from "./ShapeTools";
import type { ShapeSelection } from "./ShapeTools";
import { AroundRoom } from "./AroundRoom";
import { addOpening, mainEntrance, markMainEntrance, setMainEntrance, updateOpening } from "./wallModel";

interface Props { room: Room; selection: ShapeSelection; selected: string | null; onSelect: (key: string | null) => void; onSide: (selection: ShapeSelection) => void; onChange: (room: Room) => void; onError: (message: string) => void }
export function WallTools({ room, selection, selected, onSelect, onSide, onChange, onError }: Props) {
  const side = selection?.kind === "side" && selection.index < room.outline.points.length ? selection.index : 0;
  const opening = room.openings.find(o => o.key === selected);
  const apply = (change: () => Room) => { try { onChange(change()); } catch (caught) { onError(caught instanceof Error ? caught.message : "Check the opening."); } };
  const entrance = mainEntrance(room);
  const [entranceWall, setEntranceWall] = useState(String(entrance?.side ?? side)), [entranceError, setEntranceError] = useState("");
  return <div className="room-form">
    <section className="room-entrance" aria-labelledby="room-entrance-title">
      <h3 id="room-entrance-title">Main entrance</h3>
      <Select label="Wall of the main entrance" value={entranceWall} options={room.outline.points.map((_, i) => ({ value: String(i), label: `Wall ${i + 1}` }))} onChange={e => { setEntranceWall(e.target.value); setEntranceError(""); }} />
      <Button variant={entrance ? "secondary" : "primary"} disabled={entrance?.side === Number(entranceWall)} onClick={() => {
        try { const next = setMainEntrance(room, Number(entranceWall)); setEntranceError(""); onChange(next); onSelect(mainEntrance(next)!.key); }
        catch (caught) { setEntranceError(caught instanceof Error ? caught.message : "Check the wall."); }
      }}>{entrance ? "Move main entrance here" : "Set main entrance"}</Button>
      {entranceError && <p role="alert" className="room-error">{entranceError}</p>}
    </section>
    <AroundRoom room={room} side={side} onSide={index => onSide({ kind: "side", index })} onChange={onChange} />
    <h3>Add on Wall {side + 1}</h3>
    {(["window", "door"] as const).map(kind => <Button key={kind} variant="secondary" onClick={() => apply(() => { const next = addOpening(room, side, kind); onSelect(next.openings.at(-1)!.key); return next; })}>{kind === "window" ? "Add window" : "Add door"}</Button>)}
    <Select label="Selected opening" value={opening?.key ?? ""} options={[{ value: "", label: "Choose an opening" }, ...room.openings.map((o, i) => ({ value: o.key, label: `${o.kind === "glass_wall" ? "Glass wall" : o.kind === "door" ? "Door" : "Window"} ${i + 1} · Wall ${o.side + 1}${o.is_main_entrance ? " · Main entrance" : ""}` }))]} onChange={e => onSelect(e.target.value || null)} />
    {opening && <OpeningFields key={opening.key} room={room} opening={opening} onMainEntrance={on => apply(() => on ? markMainEntrance(room, opening.key) : updateOpening(room, opening.key, { is_main_entrance: false }))} onNumberUpdate={change => { try { onChange(updateOpening(room, opening.key, change)); } catch (caught) { onError(caught instanceof Error ? caught.message : "Check the opening."); throw caught; } }} />}
    {opening && <Button variant="danger" onClick={() => { onChange({ ...room, openings: room.openings.filter(o => o.key !== opening.key) }); onSelect(null); }}>Remove opening</Button>}
  </div>;
}

function OpeningFields({ room, opening: o, onMainEntrance, onNumberUpdate }: { room: Room; opening: RoomOpening; onMainEntrance: (on: boolean) => void; onNumberUpdate: (change: Partial<RoomOpening>) => void }) {
  return <>
    <h3>{o.kind === "door" ? "Door" : o.kind === "glass_wall" ? "Glass wall" : "Window"} properties</h3>
    {o.kind === "glass_wall" ? <p>Width: {Math.round(o.width)} cm · Entire wall</p>
      : <RoomNumberField label="Opening width (cm)" value={o.width} min={40} max={sideLength(room.outline, o.side) - o.offset} onCommit={width => onNumberUpdate({ width })} />}
    {o.kind === "door" && <Checkbox label="This door is the main entrance" checked={o.is_main_entrance} onChange={e => onMainEntrance(e.target.checked)} />}
  </>;
}
