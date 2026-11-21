// The live floor during service. Built to be read standing up: status counts
// in big type, a table board with words and patterns, and the map. Every
// change by anyone (diners booking online, other staff) arrives through
// useLive within about 2 seconds.
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { getFloor, moveBooking, venueDayScope } from "../../api/restaurant";
import type { StaffBooking, StaffFloor as Floor, StaffTable } from "../../api/restaurant";
import { useLive } from "../../api/useLive";
import { Button, Dialog, ErrorState, Skeleton, useToast } from "../../design/components";
import { SeatMap } from "../../seatmap/SeatMap";
import { ArrivalsList, TableBoard, readDraggedBooking } from "./FloorLists";
import { errorMessage, formatDate, fromMinutes, needsSignIn, tablesText, toMinutes } from "./format";
import { MapKey } from "./MapKey";
import { MoveDialog } from "./MoveDialog";
import { SelectionPanel } from "./SelectionPanel";
import { SignInPrompt } from "./SignInPrompt";
import { FLOOR_LOOK, FLOOR_ORDER, STAFF_KEY, countByStatus, describeStaffTables, staffMapTables, upcomingArrivals } from "./staffStatus";
import { nowTime, roundToSlot } from "./TimeScrubber";
import { WalkinDialog } from "./WalkinDialog";
import { useLoad } from "./useLoad";
import { WhatIfCard } from "./WhatIf";

function referenceNow(timezone?: string): string {
  return timezone ? roundToSlot(new Intl.DateTimeFormat("en-GB", {timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date())) : nowTime();
}

export function StaffFloor({ venueId, date, timezone, onToday }: { venueId: string; date: string; timezone?: string; onToday?: () => void }) {
  const [time, setTime] = useState(() => referenceNow(timezone));
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!live) return;
    const tick = (): void => setTime(referenceNow(timezone));
    tick();
    const interval = window.setInterval(tick, 15_000);
    return () => window.clearInterval(interval);
  }, [live, timezone]);
  const { state, reload } = useLoad(() => getFloor(venueId, date, time), `${date}|${time}`);
  useLive(venueDayScope(venueId, date), () => reload(true));
  if (state.status === "loading") return <Skeleton lines={8} label="Loading the floor" />;
  if (state.status === "error") {
    if (needsSignIn(state.error)) return <SignInPrompt venueId={venueId} />;
    return <ErrorState title="We could not load the floor" message={errorMessage(state.error)} onRetry={() => reload()} />;
  }
  const today = new Intl.DateTimeFormat("sv-SE", {timeZone: timezone, year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  return <><p className="rb-muted st-small">{timezone ? `Times shown in ${timezone}.` : "Using the device clock. Verify the restaurant's local time before seating a walk-in."}</p><FloorView venueId={venueId} date={date} floor={state.data} time={time} live={live && date === today} onNow={() => {onToday?.(); setLive(true); setTime(referenceNow(timezone));}} onTime={value => {setLive(false); setTime(value);}} onRefresh={() => reload(true)} /></>;
}

interface FloorViewProps {
  venueId: string;
  /** The day on screen: what-if and walk-ins are asked about this day, not the server's today. */
  date: string;
  floor: Floor;
  time: string;
  live: boolean;
  onNow: () => void;
  onTime: (time: string) => void;
  onRefresh: () => void;
}

/** The id of the table under the pointer when something is dropped on the map. */
function tableIdAt(event: DragEvent): number | null {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('[role="option"]');
  // SeatMap gives each table the DOM id "<map id>-t<table id>" (seatmap/Targets.tsx, targetDomId).
  const match = element?.id.match(/-t(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Moving bookings by drag and drop or by "Move here". Reports the result in words. */
function useMoves(venueId: string, floor: Floor, onMoved: (booking: StaffBooking, previousIds: number[]) => void, problem: (message: string) => void) {
  const moveTo = (id: string, target: StaffTable): void => {
    const moved = floor.bookings.find((b) => b.id === id);
    const name = moved?.name ?? "The booking";
    moveBooking(venueId, id, [target.id]).then(
      (booking) => onMoved(booking, moved?.table_ids ?? []),
      (error: unknown) => problem(errorMessage(error, `Could not move ${name} to table ${target.label}.`)),
    );
  };
  const dropOn = (id: string, targetId: number | null): void => {
    const target = floor.tables.find((t) => t.id === targetId);
    if (target) moveTo(id, target);
  };
  const dropOnMap = (event: DragEvent): void => {
    event.preventDefault();
    const id = readDraggedBooking(event);
    if (id) dropOn(id, tableIdAt(event));
  };
  return { moveTo, dropOn, dropOnMap };
}

function FloorView({ venueId, date, floor, time, live, onNow, onTime, onRefresh }: FloorViewProps) {
  const toast = useToast();
  const [tableId, setTableId] = useState<number | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [moving, setMoving] = useState<StaffBooking | null>(null);
  const [walkin, setWalkin] = useState(false);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");
  const [queue, setQueue] = useState<"Upcoming" | "Seated" | "All active">("Upcoming");
  const [spoken, setSpoken] = useState("");
  const selectedPanel = useRef<HTMLElement>(null);
  // The tables this member of staff just changed: the map shows that change without reading it out again.
  const [actedOn, setActedOn] = useState<number[]>([]);
  const table = floor.tables.find((t) => t.id === tableId) ?? null;
  const booking = floor.bookings.find((b) => b.id === bookingId) ?? null;
  const chooseTable = (id: number): void => {
    const target = floor.tables.find((item) => item.id === id);
    setTableId(id);
    setBookingId(target?.booking_id ?? (target?.status === "free" && booking?.status === "confirmed" ? booking.id : null));
  };
  const selectBooking = (selected: StaffBooking): void => {
    setBookingId(selected.id);
    setTableId(selected.table_ids[0] ?? null);
  };
  const arrivals = queue === "Upcoming" ? upcomingArrivals(floor.bookings) : floor.bookings
    .filter((item) => queue === "All active" || item.status === "seated" || item.status === "finishing")
    .sort((a, b) => a.time.localeCompare(b.time));
  const openWalkin = (): void => { onTime(time); setWalkin(true); };
  // Every successful action: say it out loud, close dialogs, fetch the floor again.
  const done = (message: string, tableIds: number[]): void => {
    setActedOn(tableIds);
    setSpoken(message);
    toast.show(message, "success");
    setMoving(null);
    setWalkin(false);
    onRefresh();
  };
  const onMoved = (updated: StaffBooking, previousIds: number[]): void => {
    selectBooking(updated);
    done(`${updated.name} is now at ${tablesText(updated.table_labels)}.`, [...previousIds, ...updated.table_ids]);
  };
  const problem = (message: string): void => toast.show(message, "danger");
  const { moveTo, dropOn, dropOnMap } = useMoves(venueId, floor, onMoved, problem);

  return (
    <div className="st-floor">
      <FloorHeader floor={floor} date={date} time={time} live={live} onNow={onNow} onTime={onTime} onWalkin={openWalkin} onCheck={() => {onTime(time); setChecking(true);}} />
      <div className="st-grid">
        <section className="rb-card st-arrivals-panel" aria-labelledby="st-arrivals-title">
          <h2 id="st-arrivals-title" className="rb-service-title">Arrivals</h2>
          <div className="st-queue-views" role="group" aria-label="Filter arrivals">
            {(["Upcoming", "Seated", "All active"] as const).map((filter) => (
              <Button key={filter} variant={queue === filter ? "primary" : "secondary"} aria-pressed={queue === filter} onClick={() => setQueue(filter)}>{filter}</Button>
            ))}
          </div>
          <ArrivalsList
            arrivals={arrivals}
            services={floor.services}
            selectedId={bookingId}
            label={queue === "Upcoming" ? "Upcoming arrivals" : queue === "Seated" ? "Seated parties" : "All active parties"}
            empty={queue === "Seated" ? "No parties are seated." : queue === "All active" ? "No active parties for this day." : undefined}
            onSelect={(id) => {
              const selected = floor.bookings.find((item) => item.id === id);
              if (!selected) return;
              selectBooking(selected);
              window.requestAnimationFrame(() => selectedPanel.current?.focus());
            }}
          />
        </section>
        <div className="st-side">
          <section className="rb-card st-selected-panel" aria-labelledby="st-selected-title" ref={selectedPanel} tabIndex={-1}>
            <h2 id="st-selected-title" className="st-selection-label">Reservation details</h2>
            <SelectionPanel venueId={venueId} floor={floor} table={table} booking={booking} onChanged={(message) => {
              done(message, booking?.table_ids ?? (table ? [table.id] : []));
              selectedPanel.current?.focus();
            }} onProblem={problem} onMove={setMoving} onMoveHere={(b, t) => moveTo(b.id, t)} onWalkin={openWalkin} />
          </section>
        <div className="st-main"><h2 className="st-plan-title">Floor plan</h2>
          <div className="st-view-controls" role="group" aria-label="Floor view"><Button variant={view === "map" ? "primary" : "secondary"} aria-pressed={view === "map"} onClick={() => setView("map")}>Map</Button><Button variant={view === "list" ? "primary" : "secondary"} aria-pressed={view === "list"} onClick={() => setView("list")}>Tables list</Button></div>
          <div hidden={view !== "map"} onDragOver={(e) => e.preventDefault()} onDrop={dropOnMap}>
            <SeatMap
              label={`Floor at ${time}`}
              mode="tables"
              tables={staffMapTables(floor.tables)}
              seats={floor.seats}
              zones={floor.zones}
              selectable={() => true}
              selectedId={tableId}
              marked={new Set(booking?.table_ids ?? [])}
              markedLabel="selected booking"
              describe={describeStaffTables(floor.tables)}
              actedOn={actedOn}
              onSelect={chooseTable}
            />
          </div>
          {view === "map" && <MapKey entries={STAFF_KEY} label="Table status key" />}
          {view === "list" && <TableBoard floor={floor} selectedId={tableId} onSelect={chooseTable} onDropBooking={dropOn} />}
        </div>
        </div>
      </div>
      <MoveDialog venueId={venueId} booking={moving} tables={floor.tables} onClose={() => setMoving(null)} onMoved={(b) => onMoved(b, moving?.table_ids ?? [])} />
      <WalkinDialog serviceName={floor.services.find(service=>service.start_time<=time && time<service.end_time)?.name} venueId={venueId} date={date} time={time} inService={floor.services.some(service => service.start_time <= time && time < service.end_time)} open={walkin} onClose={() => setWalkin(false)} onSeated={(b) => {
        selectBooking(b);
        setQueue("Seated");
        done(`Walk-in of ${b.party_size} seated at ${tablesText(b.table_labels)}.`, b.table_ids);
      }} />
      <Dialog open={checking} title={`Check a walk-in at ${time}`} onClose={() => setChecking(false)} actions={<Button variant="secondary" onClick={() => setChecking(false)}>Close simulation</Button>}>
        <p>Simulation only · {formatDate(date)} at {time}. No booking is created and no table is moved.</p>
        {checking && <WhatIfCard key={`${date}|${time}`} venueId={venueId} date={date} time={time} />}
      </Dialog>
      <span className="visually-hidden" role="status" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

function FloorHeader({ floor, date, time, live, onNow, onTime, onWalkin, onCheck }: { floor: Floor; date: string; time: string; live: boolean; onNow: () => void; onTime: (t: string) => void; onWalkin: () => void; onCheck: () => void }) {
  const [editingTime,setEditingTime]=useState(false);
  const counts = countByStatus(floor.tables);
  const service = floor.services.find(s => s.start_time <= time && time < s.end_time)?.name ?? "Outside service";
  return (
    <div className="st-floor-head">
      <ul className="st-counts" aria-label="Tables by status">
        {FLOOR_ORDER.map((status) => (
          <li key={status} className={`st-count st-count-${status}`}>
            <span className="st-count-number tabular">{counts[status]}</span> {FLOOR_LOOK[status].label}
          </li>
        ))}
      </ul>
      <div className="st-time-reference">
        <strong role="status">{live ? `Live now · ${time} · ${service}` : `Viewing ${time} · ${service}`}</strong>
        <span className="rb-muted st-small">{formatDate(date)} · 15-minute floor reference. Viewing does not change bookings.</span>
        <Button variant="secondary" aria-expanded={editingTime} onClick={()=>setEditingTime(!editingTime)}>Change floor time</Button>
        {editingTime && <label className="st-time-slider">View floor time<input type="range" min={0} max={1425} step={15} value={toMinutes(time)} aria-label="View floor time" aria-valuetext={`${time}, ${service}`} onChange={event => onTime(fromMinutes(Number(event.target.value)))} /></label>}
        {!live && <Button variant="secondary" onClick={onNow}>Return to now</Button>}
      </div>
      <div className="st-quick-actions"><Button onClick={onWalkin}>New walk-in</Button><Button variant="secondary" onClick={onCheck}>Check a walk-in</Button></div>
    </div>
  );
}
