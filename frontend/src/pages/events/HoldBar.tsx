// The bar that appears while a seat is held: which seat, how long is left,
// and the one button that finishes the job. It sticks to the bottom of a
// phone screen so the Confirm button is always under the thumb.
import { Button } from "../../design/components";

interface HoldBarProps {
  seatLabel: string;
  secondsLeft: number;
  busy: boolean;
  onConfirm: () => void;
}

export function HoldBar({ seatLabel, busy, onConfirm }: HoldBarProps) {
  return (
    <div className="ev-holdbar" role="region" aria-label="Selected seat">
      <div className="ev-holdbar-text">
        <span className="ev-holdbar-label">Selected seat</span>
        <strong>{seatLabel}</strong>
        <span>Available until someone confirms it.</span>
      </div>
      <Button busy={busy} onClick={onConfirm}>
        Confirm this seat
      </Button>
    </div>
  );
}
