// One card for the table in front of the diner: our suggestion on arrival, the table they pointed
// at, or the one they hold. It says which room, which kind of table, the view, how many it seats
// and the light, and carries the one action for that table. The reasons we give for a suggestion
// sit behind "Why this table", so the card stays short beside the plan.
import type { DinerTable } from "../../api/restaurant";
import { Badge, Button } from "../../design/components";
import { lightWords } from "./ambienceView";
import { guests, tableName } from "./format";
import { partyRange, unavailableReason } from "./tableView";

interface TableCardProps {
  table: DinerTable;
  /** The room the table is in; null for a restaurant with a single room. */
  roomName: string | null;
  /** The zone the table sits in ("Window"), if the restaurant named one. */
  zone: string | null;
  /** True when this is the table we suggest. */
  recommended: boolean;
  /** Why we suggest it, in plain words. Only shown for the suggestion. */
  reasons: string[];
  heldId: number | null;
  busy: boolean;
  onTake: (tableId: number) => void;
  /** The quick suggestion of a phone: the table in words (no photo, no button of its own); the page's sticky button takes it. */
  quick?: { party: number };
}

/** The reasons we give for a suggestion, then what the table is like, without saying the same thing twice. */
function lines(reasons: string[], phrases: string[]): string[] {
  const seen = new Set<string>();
  return [...reasons, ...phrases].filter((line) => {
    const key = line.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Small line icons for the facts of a table: where, the view, the light and the seats. */
function FactIcon({ kind }: { kind: "where" | "view" | "sun" | "night" | "seats" }) {
  const paths: Record<typeof kind, JSX.Element> = {
    where: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    view: <path d="M3 15c3-2 6 2 9 0s6 2 9 0M3 19c3-2 6 2 9 0s6 2 9 0M12 4v6M8 7h8" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    night: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    seats: <><circle cx="12" cy="12" r="4.5" /><rect x="2" y="9.5" width="3" height="5" rx="1" /><rect x="19" y="9.5" width="3" height="5" rx="1" /></>,
  };
  return (
    <svg className={`rb-fact-icon is-${kind}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

export function TableCard({ table, roomName, zone, recommended, reasons, heldId, busy, onTake, quick }: TableCardProps) {
  const ambience = table.ambience;
  const reason = unavailableReason(table);
  const held = table.id === heldId && table.state !== "taken";
  const text = lines(recommended ? reasons : [], ambience?.phrases ?? []);
  const meta = [ambience?.view?.text, `Seats ${table.max_party}`, ambience ? lightWords(ambience.light) : null].filter(Boolean).join(" · ");
  if (quick) {
    // "Window table · 2 guests", then "R2 · The river lights · Seats 2": where, for how many, and why it is good.
    return (
      <section className="rb-card rb-table-card rb-table-quick" aria-label={`Table ${table.label}, ${partyRange(table)}`}>
        {recommended && <Badge tone="success">Recommended</Badge>}
        <h3 className="rb-table-title">
          {zone ? `${zone} table` : tableName(table.label)} · {guests(quick.party)}
        </h3>
        <p className="rb-muted rb-table-meta">
          {[roomName, table.label, meta].filter(Boolean).join(" · ")}
        </p>
        {reason && <p className="rb-muted rb-table-card-reason">{reason}</p>}
        {text.length > 0 && (
          <details className="rb-why">
            <summary>Why this table</summary>
            <ul className="rb-reasons">
              {text.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    );
  }
  return (
    <section className="rb-card rb-table-card" aria-label={`Table ${table.label}, ${partyRange(table)}`}>
      <div className="rb-table-card-head">
        <div>
          {roomName && <p className="rb-table-room">{roomName}</p>}
          <h3 className="rb-table-title">
            {tableName(table.label)}
            {zone ? ` · ${zone} table` : ""}
          </h3>
        </div>
        {recommended && !held && <Badge tone="success">Recommended</Badge>}
      </div>
      <ul className="rb-table-facts">
        {zone && (
          <li>
            <FactIcon kind="where" />
            {roomName ? `${zone} table, ${roomName}` : `${zone} table`}
          </li>
        )}
        {ambience?.view?.text && (
          <li>
            <FactIcon kind="view" />
            {ambience.view.text}
          </li>
        )}
        {ambience && (
          <li>
            <FactIcon kind={ambience.light === "night" || ambience.light === "sunset" ? "night" : "sun"} />
            {lightWords(ambience.light)}
          </li>
        )}
        <li>
          <FactIcon kind="seats" />
          {partyRange(table)}
        </li>
      </ul>
      {ambience?.view?.photo_url && <img className="rb-view-photo" src={ambience.view.photo_url} alt={ambience.view.text || "The view from this table"} loading="lazy" />}
      {held ? (
        <Badge tone="success">Held for you</Badge>
      ) : reason ? (
        <p className="rb-muted rb-table-card-reason">{reason}</p>
      ) : (
        <>
          <Button busy={busy} onClick={() => onTake(table.id)}>
            Hold {table.label} &amp; continue <span aria-hidden="true">{"→"}</span>
          </Button>
          <p className="rb-muted rb-table-note">You will have five minutes to finish after holding the table.</p>
        </>
      )}
      {text.length > 0 && (
        <details className="rb-why">
          <summary>Why this table</summary>
          <ul className="rb-reasons">
            {text.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
