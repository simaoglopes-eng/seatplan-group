// The bar that appears while seats are selected: which seats, a reminder that
// nothing is booked yet, and the one button for the next step ("Continue" to
// "Who is sitting where?", or "Move Bea here"). It sticks to the bottom of a
// phone screen so the button is always under the thumb.
import { Button } from "../../design/components";

interface HoldBarProps {
  /** The selected seats' names, in order ("Table 1, seat 3"). */
  seatLabels: string[];
  busy: boolean;
  /** The button's words, for example "Continue". */
  actionLabel: string;
  onAction: () => void;
}

export function HoldBar({ seatLabels, busy, actionLabel, onAction }: HoldBarProps) {
  const many = seatLabels.length > 1;
  return (
    <div className="ev-holdbar" role="region" aria-label="Selected seat">
      <div className="ev-holdbar-text">
        <span className="ev-holdbar-label">{many ? "Selected seats" : "Selected seat"}</span>
        <strong>{many ? `${seatLabels.length} seats selected` : seatLabels[0]}</strong>
        {many && <span className="ev-holdbar-seats">{seatLabels.join(" · ")}</span>}
        <span>Available until someone confirms it.</span>
      </div>
      <Button busy={busy} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
