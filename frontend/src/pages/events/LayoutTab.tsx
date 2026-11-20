// Layout tab: one-click room setups for event staff (docs/api.md, "Event room
// layouts"). Two taps: choose a setup (it shows on the map, nothing changes
// yet), then "Apply"; a third, the confirm, only when guests already have a
// seat or seats run short. When guests already have a seat, or the setup has fewer
// seats than guests coming, the server asks first (409 `guests_seated`, 422
// `not_enough_seats`); a dialog says what will happen and applies on confirm.
// Each event has its own copy of the hall, so other events there never change.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import * as eventsApi from "../../api/events";
import type { EventLayouts, LayoutConfirmFacts, LayoutPreset, OrganiserEvent } from "../../api/events";
import { Badge, Button, Dialog, ErrorState, Skeleton, useToast } from "../../design/components";
import { appliedMessage, capacityFit, confirmLines, confirmFacts, currentLine } from "./layoutModel";
import { LayoutThumb } from "./LayoutThumb";
import type { OrganiserState } from "./useOrganiser";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: EventLayouts };

interface Asking {
  preset: LayoutPreset;
  facts: LayoutConfirmFacts;
}

export function LayoutTab({ org, data }: { org: OrganiserState; data: OrganiserEvent }) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const selected = org.layoutPreview?.key ?? null;
  const venueName = data.event.venue_name ?? data.venue.name;
  // Fetch again when the room or the guest counts change (live updates included).
  const coming = data.guests.filter((g) => g.rsvp !== "no");
  // The first seat id changes whenever the room is set up again (every seat is new), even from another session.
  const countsKey = `${data.venue.public_id}:${data.map.seats[0]?.id ?? 0}:${coming.length}:${coming.filter((g) => g.seat_id !== null).length}`;

  const fetchLayouts = useCallback(async (): Promise<void> => {
    try {
      const answer = await eventsApi.getLayouts(org.eventId);
      setLoad({ status: "ready", data: answer });
    } catch (error) {
      setLoad({ status: "error", message: error instanceof ApiError ? error.message : "The room setups did not load." });
    }
  }, [org.eventId]);

  useEffect(() => {
    void fetchLayouts();
  }, [fetchLayouts, countsKey]);

  const choose = (preset: LayoutPreset): void => {
    if (selected === preset.key) {
      org.setLayoutPreview(null);
      org.announce("Preview closed. The map shows the current plan.");
      return;
    }
    org.setPreview(null);
    org.setLayoutPreview(preset);
    setResult(null);
    org.announce(`${preset.label} setup is on the map. Nothing has changed yet: apply it to use it.`);
  };

  const apply = async (preset: LayoutPreset, confirm: boolean): Promise<void> => {
    setBusy(true);
    try {
      const answer = await eventsApi.applyLayout(org.eventId, preset.key, confirm);
      // Every seat is new: drop anything that still points at the old ones, after the map has the new plan.
      await org.reload().catch(() => undefined);
      org.setLayoutPreview(null);
      org.setPreview(null);
      org.setPendingMove(null);
      org.setSelectedGuest(null);
      setAsking(null);
      setLoad({ status: "ready", data: answer });
      const text = appliedMessage(preset.label, answer.reseated, answer.unseated);
      setResult(text);
      org.announce(text);
      toast.show(text, "success");
    } catch (error) {
      const facts = confirmFacts(error);
      if (facts && !confirm) {
        setAsking({ preset, facts });
        return;
      }
      setAsking(null);
      const text = error instanceof ApiError ? error.message : "The setup was not applied. Please try again.";
      org.announce(`Problem: ${text}`);
      toast.show(text, "danger");
    } finally {
      setBusy(false);
    }
  };

  if (load.status === "loading") return <Skeleton lines={6} label="Loading the room setups" />;
  if (load.status === "error") return <ErrorState title="The room setups did not load" message={load.message} onRetry={() => void fetchLayouts()} />;
  const layouts = load.data;
  const labels = Object.fromEntries(layouts.presets.map((p) => [p.key, p.label]));

  return (
    <div className="ev-panel-stack">
      <section className="ev-card-flat" aria-labelledby="ev-layout-now">
        <h3 id="ev-layout-now" className="ev-subtitle">
          Room setup
        </h3>
        <p>
          <strong>{currentLine(layouts, labels)}</strong>
          <span className="ev-muted">
            {" "}
            · {layouts.seated} of {layouts.guests} guests seated
          </span>
        </p>
        <p className="ev-muted">
          Choose a setup to see it on the map, then apply it. This event has its own copy of {venueName}: other events there do not change.
        </p>
        {result && (
          <p className="ev-layout-result" role="status">
            {result}
          </p>
        )}
        <FineTune layouts={layouts} />
      </section>
      <ul className="ev-layout-grid" aria-label="Room setups">
        {layouts.presets.map((preset) => (
          <PresetCard
            key={preset.key}
            preset={preset}
            guests={layouts.guests}
            inUse={layouts.current === preset.key}
            selected={selected === preset.key}
            busy={busy}
            onChoose={() => choose(preset)}
            onApply={() => void apply(preset, false)}
          />
        ))}
      </ul>
      {asking && <ConfirmDialog asking={asking} busy={busy} onCancel={() => setAsking(null)} onConfirm={() => void apply(asking.preset, true)} />}
    </div>
  );
}

function FineTune({ layouts }: { layouts: EventLayouts }) {
  if (!layouts.own_layout) {
    return <p className="ev-muted">Apply a setup first. You can then fine-tune this event's own copy of the room in the editor.</p>;
  }
  return (
    <p>
      <Link to={`/editor/${encodeURIComponent(layouts.venue_id)}`} className="btn btn-secondary">
        Fine-tune in the editor
      </Link>
    </p>
  );
}

interface PresetCardProps {
  preset: LayoutPreset;
  guests: number;
  inUse: boolean;
  selected: boolean;
  busy: boolean;
  onChoose: () => void;
  onApply: () => void;
}

function PresetCard({ preset, guests, inUse, selected, busy, onChoose, onApply }: PresetCardProps) {
  const fit = capacityFit(preset.capacity, guests);
  return (
    <li className={`ev-layout-item${selected ? " is-selected" : ""}`}>
      <button type="button" className="ev-layout-card" aria-pressed={selected} disabled={fit.tone === "none"} onClick={onChoose}>
        <LayoutThumb preview={preset.preview} />
        <span className="ev-layout-name">
          {preset.label}
          {inUse && <Badge tone="info">In use</Badge>}
        </span>
        <span className="ev-layout-desc">{preset.description}</span>
        <span className={`ev-layout-fit is-${fit.tone}`}>{fit.text}</span>
      </button>
      {selected && !inUse && (
        <Button busy={busy} onClick={onApply}>
          Apply {preset.label} setup
        </Button>
      )}
      {selected && inUse && <p className="ev-muted">This is the setup in use.</p>}
    </li>
  );
}

interface ConfirmDialogProps {
  asking: Asking;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ asking, busy, onCancel, onConfirm }: ConfirmDialogProps) {
  const { preset, facts } = asking;
  const actions = (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Keep the current setup
      </Button>
      <Button busy={busy} onClick={onConfirm}>
        {facts.seated > 0 ? "Apply and re-seat guests" : "Apply anyway"}
      </Button>
    </>
  );
  return (
    <Dialog open title={`Apply the ${preset.label} setup?`} onClose={onCancel} actions={actions}>
      {confirmLines(preset.label, facts).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </Dialog>
  );
}
