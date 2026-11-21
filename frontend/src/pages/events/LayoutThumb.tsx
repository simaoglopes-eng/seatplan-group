// A room setup drawn small for its card in the Layout tab: the front zone
// (stage, screen, bar), the tables and a dot per seat, from the `preview` the
// server sends (whole centimetres, front of the room at the top). Decorative:
// the card's text says the same in words.
import type { LayoutPreview } from "../../api/events";
import { thumbTransform } from "./layoutModel";

export function LayoutThumb({ preview }: { preview: LayoutPreview }) {
  const seatRadius = Math.max(preview.width, preview.height) / 110;
  return (
    <svg className="ev-thumb" viewBox={`0 0 ${preview.width} ${preview.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <rect className="ev-thumb-room" x={0} y={0} width={preview.width} height={preview.height} />
      {preview.zones.map((zone, index) => (
        <rect key={`z${index}`} className="ev-thumb-zone" x={zone.x} y={zone.y} width={zone.w} height={zone.h} />
      ))}
      {preview.tables.map((table, index) => (
        <g key={`t${index}`}>
          {table.shape === "round" ? (
            <ellipse className="ev-thumb-table" cx={table.x + table.w / 2} cy={table.y + table.h / 2} rx={table.w / 2} ry={table.h / 2} />
          ) : (
            <rect className="ev-thumb-table" x={table.x} y={table.y} width={table.w} height={table.h} transform={thumbTransform(table)} />
          )}
          {table.seats.map((seat, n) => (
            <circle key={n} className="ev-thumb-seat" cx={seat.x} cy={seat.y} r={seatRadius} />
          ))}
        </g>
      ))}
    </svg>
  );
}
