import { useState } from "react";
import { Link } from "react-router-dom";
import { cancelDinerBooking, getDinerBookings, getFavorites, removeFavorite } from "../../api/diner";
import type { DinerBooking } from "../../api/diner";
import { Button, Dialog, ErrorState, Skeleton, useToast } from "../../design/components";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import "./dinerAccount.css";

export function DinerDashboard() {
  const [offset, setOffset] = useState(0);
  const bookings = useLoad(() => getDinerBookings(offset), String(offset));
  const favorites = useLoad(getFavorites, "favorites");
  const [cancel, setCancel] = useState<DinerBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const toast = useToast();

  async function confirmCancel() {
    if (!cancel) return;
    setBusy(true);
    try {
      await cancelDinerBooking(cancel.id);
      setCancel(null);
      bookings.reload();
      toast.show("Booking cancelled.", "success");
    } catch (error) { toast.show(errorMessage(error), "danger"); }
    finally { setBusy(false); }
  }
  async function unsave(slug: string) {
    setRemoving(slug);
    try { await removeFavorite(slug); favorites.reload(); }
    catch (error) { toast.show(errorMessage(error), "danger"); }
    finally { setRemoving(null); }
  }
  return <div className="diner-dashboard">
    <section aria-labelledby="diner-bookings-title">
      <h2 id="diner-bookings-title">My bookings</h2>
      <p>Your upcoming visits and booking history. Older bookings appear after your email has been verified.</p>
      {bookings.state.status === "loading" && <Skeleton lines={4} label="Loading bookings" />}
      {bookings.state.status === "error" && <ErrorState title="Could not load bookings" message={errorMessage(bookings.state.error)} onRetry={bookings.reload} />}
      {bookings.state.status === "ready" && <>
        {bookings.state.data.items.length === 0 && <p>No bookings here yet. <Link to="/">Find a table</Link></p>}
        <ul className="diner-booking-list">{bookings.state.data.items.map(row => <li key={row.id}>
          <div><h3>{row.restaurant.name}</h3><p>{row.date} · {row.time} · {row.party_size} people</p>
            <span className="diner-booking-status">{row.status.replaceAll("_", " ")}</span>
            {row.tables.length > 0 && <p>Table {row.tables.join(", ")}</p>}
          </div>
          <div className="diner-booking-actions">
            {row.restaurant.slug && <Link className="btn btn-secondary" to={`/restaurants/${encodeURIComponent(row.restaurant.slug)}?party=${row.party_size}#book`}>Book again</Link>}
            {row.can_cancel && <Button variant="ghost" onClick={() => setCancel(row)}>Cancel booking</Button>}
          </div>
        </li>)}</ul>
        {bookings.state.data.total > 20 && <nav className="diner-pagination" aria-label="Booking pages">
          <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
          <span>{offset + 1}–{Math.min(offset + 20, bookings.state.data.total)} of {bookings.state.data.total}</span>
          <Button variant="secondary" disabled={offset + 20 >= bookings.state.data.total} onClick={() => setOffset(offset + 20)}>Next</Button>
        </nav>}
      </>}
    </section>
    <section aria-labelledby="diner-favorites-title"><h2 id="diner-favorites-title">Saved restaurants</h2>
      {favorites.state.status === "loading" && <Skeleton lines={2} label="Loading saved restaurants" />}
      {favorites.state.status === "error" && <ErrorState title="Could not load saved restaurants" message={errorMessage(favorites.state.error)} onRetry={favorites.reload} />}
      {favorites.state.status === "ready" && <>
        {favorites.state.data.items.length === 0 && <p>Save restaurants from their page to find them here.</p>}
        <ul className="diner-booking-list">{favorites.state.data.items.map(row => <li key={row.slug}>
          <Link to={`/restaurants/${encodeURIComponent(row.slug)}`}>{row.name}</Link>
          <Button variant="ghost" busy={removing === row.slug} disabled={removing !== null && removing !== row.slug} onClick={() => void unsave(row.slug)}>Remove</Button>
        </li>)}</ul>
      </>}
    </section>
    <Dialog open={cancel !== null} title="Cancel this booking?" onClose={() => { if (!busy) setCancel(null); }}>
      <p>{cancel?.restaurant.name} · {cancel?.date} · {cancel?.time}. Your table will become available for other guests.</p>
      <div className="diner-booking-actions"><Button variant="secondary" disabled={busy} onClick={() => setCancel(null)}>Keep booking</Button><Button variant="danger" busy={busy} onClick={() => void confirmCancel()}>Cancel booking</Button></div>
    </Dialog>
  </div>;
}
