import { useState } from "react";
import { getCustomerHistory } from "../../api/restaurant";
import { Button, ErrorState, Skeleton } from "../../design/components";
import { errorMessage, formatDate, people } from "./format";
import { useLoad } from "./useLoad";

export function CustomerHistory({ venueId, bookingId }: { venueId: string; bookingId: string }) {
  const [open, setOpen] = useState(false);
  return <section>
    <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>Customer history</Button>
    {open && <History key={`${venueId}:${bookingId}`} venueId={venueId} bookingId={bookingId} />}
  </section>;
}

function History({ venueId, bookingId }: { venueId: string; bookingId: string }) {
  const { state, reload } = useLoad(() => getCustomerHistory(venueId, bookingId), `${venueId}:${bookingId}`);
  if (state.status === "loading") return <Skeleton lines={3} label="Loading customer history" />;
  if (state.status === "error") return <ErrorState title="Could not load customer history" message={errorMessage(state.error)} onRetry={reload} />;
  return <div>
    <h4>{state.data.returning_customer ? "Returning customer" : "First recorded visit"}</h4>
    <p>{state.data.completed_visits} completed visits before this booking</p>
    <p className="rb-muted">Previous bookings using the same email at this restaurant. Showing the latest ten completed visits.</p>
    <ul>{state.data.visits.map((visit, index) => <li key={`${visit.date}:${visit.time}:${index}`}>
      <strong>{formatDate(visit.date)}</strong> · {visit.time} · {people(visit.party_size)}
      {visit.occasion && <p>Occasion: {visit.occasion}</p>}
      {visit.notes && <p>Previous note: {visit.notes}</p>}
    </li>)}</ul>
  </div>;
}
