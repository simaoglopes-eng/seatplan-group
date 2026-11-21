import { useEffect, useId, useRef, useState } from "react";
import { formatDate, todayIso } from "../restaurant/format";

function monthStart(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function DiscoveryDate({ value, onChange, stacked }: {
  value: string;
  onChange: (value: string) => void;
  stacked: boolean;
}) {
  const id = useId();
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const minimum = todayIso();
  const [month, setMonth] = useState(() => monthStart(value || minimum));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const offset = (month.getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const preview = value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : "Choose a date";

  useEffect(() => {
    if (!open) return;
    calendar.current?.querySelector<HTMLButtonElement>("[data-calendar-start]")?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !field.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const show = () => {
    setMonth(monthStart(value && value >= minimum ? value : minimum));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={field} className={stacked ? "field discover-date" : "discover-date"}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
        }
      }}>
      <label htmlFor={id} className={stacked ? "field-label" : undefined}>Date</label>
      <div className="discover-date-control">
        <input className={stacked ? "field-input" : undefined} id={id} type="date" aria-label="Date" min={minimum}
          value={value} onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              show();
            }
          }} />
        <span className="discover-date-preview" aria-hidden="true">{preview}</span>
        <button ref={trigger} type="button" className="discover-calendar-toggle" aria-label="Open calendar"
          aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined}
          onClick={() => { if (open) close(); else show(); }}>
          <span aria-hidden="true" />
        </button>
      </div>
      {open && <div ref={calendar} id={`${id}-calendar`} className="discover-calendar" role="group" aria-label="Booking calendar">
        <div className="discover-calendar-header">
          <button type="button" aria-label="Previous month" disabled={month <= monthStart(minimum)}
            onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>‹</button>
          <strong aria-live="polite">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</strong>
          <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>›</button>
        </div>
        <div className="discover-calendar-grid">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day} aria-hidden="true">{day}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
          {Array.from({ length: days }, (_, index) => {
            const day = index + 1;
            const date = todayIso(new Date(year, monthIndex, day));
            return <button key={day} type="button" aria-label={formatDate(date)} disabled={date < minimum}
              aria-pressed={value === date} aria-current={date === minimum ? "date" : undefined}
              data-calendar-start={date === (value && value >= minimum ? value : minimum) ? "" : undefined}
              onClick={() => { onChange(date); close(); }}>{day}</button>;
          })}
        </div>
        {value && <button type="button" className="discover-calendar-clear" onClick={() => { onChange(""); close(); }}>Clear date</button>}
      </div>}
    </div>
  );
}
