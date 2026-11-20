import { useState } from "react";
import { reportArrival } from "../../api/restaurant";
import type { BookingView } from "../../api/restaurant";
import { Button, Select, useToast } from "../../design/components";
import { errorMessage } from "./format";

export function ArrivalNotice({ token, booking, onUpdate }: { token: string; booking: BookingView; onUpdate: (booking: BookingView) => void }) {
  const [delay, setDelay] = useState("15");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function send() {
    setBusy(true);
    try {
      onUpdate(await reportArrival(token, Number(delay)));
      toast.show("Arrival time sent to the restaurant.", "success");
    } catch (error) { toast.show(errorMessage(error), "danger"); }
    finally { setBusy(false); }
  }
  return <section className="rb-card" aria-labelledby="arrival-title">
    <h2 id="arrival-title">Running late?</h2>
    {booking.arrival_time && <p role="status">Expected arrival shared with the restaurant: <strong>{booking.arrival_time}</strong></p>}
    <Select label="Your arrival" value={delay} onChange={event => setDelay(event.target.value)} options={[{value:"0",label:"On time"}, ...[5, 10, 15, 20, 30, 45, 60].map(value => ({value:String(value),label:`${value} minutes after my booked time`}))]} />
    <p className="rb-muted">This informs the staff. Your reservation time and table service remain the same.</p>
    <Button variant="secondary" busy={busy} onClick={() => void send()}>Send arrival time</Button>
  </section>;
}
