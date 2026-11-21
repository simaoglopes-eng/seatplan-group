// Settings tab: how attendees see each other (with a live preview before
// saving), the deadline after which seats can no longer be changed, how many
// seats one person can book, and the event's shared link (ShareLinkCard.tsx).
import { useState } from "react";
import * as eventsApi from "../../api/events";
import type { OrganiserEvent, PrivacyMode } from "../../api/events";
import { Button, Field } from "../../design/components";
import { previewName } from "./format";
import { ShareLinkCard } from "./ShareLinkCard";
import type { OrganiserState } from "./useOrganiser";

const MODES: { value: PrivacyMode; label: string; hint: string }[] = [
  { value: "full_name", label: "Full names", hint: "Best for teams who already know each other." },
  { value: "first_initial", label: "First name and last initial", hint: "A good default: easy to recognise, harder to search." },
  { value: "anonymous", label: "Nobody's name", hint: "Everyone sees only 'Guest'. Friends can still sit together." },
];

// Enough rows to show the rule working without listing the whole party.
const PREVIEW_ROWS = 4;

export function SettingsTab({ org, data }: { org: OrganiserState; data: OrganiserEvent }) {
  return (
    <div className="ev-panel-stack">
      <PrivacySetting org={org} data={data} />
      <DeadlineSetting org={org} data={data} />
      <PartySizeSetting org={org} data={data} />
      <ShareLinkCard org={org} data={data} />
    </div>
  );
}

function PrivacySetting({ org, data }: { org: OrganiserState; data: OrganiserEvent }) {
  const [mode, setMode] = useState<PrivacyMode>(data.event.privacy_mode);
  const sample = data.guests.slice(0, PREVIEW_ROWS);
  const changed = mode !== data.event.privacy_mode;

  return (
    <section className="ev-card-flat" aria-labelledby="ev-privacy">
      <h3 id="ev-privacy" className="ev-subtitle">
        What attendees see of each other
      </h3>
      <fieldset className="ev-radios">
        <legend className="visually-hidden">Privacy mode</legend>
        {MODES.map((option) => (
          <label key={option.value} className="ev-radio">
            <input type="radio" name="privacy" value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} />
            <span>
              <strong>{option.label}</strong>
              <span className="ev-muted ev-block">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <h4 className="ev-mini-title">Preview: what attendees will see</h4>
      <table className="ev-table">
        <thead>
          <tr>
            <th scope="col">Real name (only you)</th>
            <th scope="col">Shown to other attendees</th>
          </tr>
        </thead>
        <tbody>
          {sample.map((guest) => (
            <tr key={guest.id}>
              <td>{guest.name}</td>
              <td>
                {previewName(guest.name, mode, guest.wants_anonymous)}
                {guest.wants_anonymous && <span className="ev-muted"> (asked to be anonymous)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ev-muted">Emails, dietary notes and accessibility needs are never shown to other attendees.</p>
      <Button
        busy={org.busy === "privacy"}
        disabled={!changed}
        onClick={() => void org.run("privacy", "Privacy setting saved. Attendees see the new names now.", () => eventsApi.patchEvent(org.eventId, { privacy_mode: mode }).then(() => undefined))}
      >
        {changed ? "Save privacy setting" : "Saved"}
      </Button>
    </section>
  );
}

/** "2026-03-14T19:30" for <input type="datetime-local">, in the browser's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DeadlineSetting({ org, data }: { org: OrganiserState; data: OrganiserEvent }) {
  const [value, setValue] = useState(toLocalInput(data.event.change_deadline));
  const save = (deadline: string | null, done: string) =>
    void org.run("deadline", done, () => eventsApi.patchEvent(org.eventId, { change_deadline: deadline }).then(() => undefined));

  return (
    <section className="ev-card-flat" aria-labelledby="ev-deadline">
      <h3 id="ev-deadline" className="ev-subtitle">
        Seat change deadline
      </h3>
      <Field
        label="Attendees can change seats until"
        hint="Your local time. After this, the map is read-only for attendees and only you can move people."
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="ev-actions">
        <Button busy={org.busy === "deadline"} disabled={value === ""} onClick={() => save(new Date(value).toISOString(), "Deadline saved.")}>
          Save deadline
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setValue("");
            save(null,"Deadline removed. Attendees can change seats until the event.");
          }}
        >
          No deadline
        </Button>
      </div>
    </section>
  );
}

/** The fallback when the server does not say (backend core/limits.DEFAULT_MAX_PARTY_SIZE). */
const DEFAULT_PARTY_SIZE = 8;
const MAX_PARTY_SIZE = 500;
/** People one guest may add over the event when there is no limit (backend core/limits.PARTY_CHANGES_NO_LIMIT). */
const NO_LIMIT_PEOPLE = 24;

/** Whole numbers from 1 to 500 typed as digits only, or null. */
function parseSeats(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const seats = Number(trimmed);
  return seats >= 1 && seats <= MAX_PARTY_SIZE ? seats : null;
}

/** "Seats one person can book": the party limit (backend events_service/party.py). */
function PartySizeSetting({ org, data }: { org: OrganiserState; data: OrganiserEvent }) {
  const stored = data.event.max_party_size ?? null;
  const fallback = data.event.default_max_party_size ?? DEFAULT_PARTY_SIZE;
  const [value, setValue] = useState(stored === null || stored === 0 ? "" : String(stored));
  const seats = parseSeats(value);
  const empty = value.trim() === "";
  // Save only a real change. With "No limit" stored the field is empty, and an
  // untouched Save would quietly put the default back: type a number instead.
  const canSave = !(empty ? stored === null || stored === 0 : seats === null || seats === stored);
  const now = stored === 0 ? `No limit on seats at once. Over the whole event one person can still add at most ${NO_LIMIT_PEOPLE} people.` : `Now: ${stored ?? fallback} ${(stored ?? fallback) === 1 ? "seat" : "seats"}${stored === null ? " (the default)" : ""}.`;
  const save = (limit: number | null, done: string) =>
    void org.run("party-size", done, () => eventsApi.patchEvent(org.eventId, { max_party_size: limit }).then(() => undefined));

  return (
    <section className="ev-card-flat" aria-labelledby="ev-party-size">
      <h3 id="ev-party-size" className="ev-subtitle">
        Seats one person can book
      </h3>
      <Field
        label="Seats per person"
        hint={`Their own seat included, from 1 to ${MAX_PARTY_SIZE}. Leave it empty for the default of ${fallback}. It stops one person from booking the whole event.`}
        inputMode="numeric"
        maxLength={3}
        value={value}
        error={value.trim() !== "" && seats === null ? `Enter a number from 1 to ${MAX_PARTY_SIZE}.` : undefined}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="ev-muted">{now}</p>
      <div className="ev-actions">
        <Button
          busy={org.busy === "party-size"}
          disabled={!canSave}
          onClick={() => (seats === null ? save(null, `Seat limit saved: ${fallback} seats per person, the default.`) : save(seats, `Seat limit saved: ${seats} ${seats === 1 ? "seat" : "seats"} per person.`))}
        >
          Save seat limit
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setValue("");
            save(0, `No limit saved. One person can still add at most ${NO_LIMIT_PEOPLE} people over the whole event.`);
          }}
        >
          No limit
        </Button>
      </div>
    </section>
  );
}
