import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getGuestToken } from "../../api/client";
import { getFavorites, removeFavorite, saveFavorite } from "../../api/diner";
import { Button, useToast } from "../../design/components";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";

export function FavoriteButton({ slug }: { slug: string }) {
  const signedIn = Boolean(getGuestToken());
  const { state, reload } = useLoad(() => signedIn ? getFavorites() : Promise.resolve({ items: [] }), `${slug}:${signedIn}`);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const location = useLocation();
  if (!signedIn) return <Link className="btn btn-secondary" to="/restaurants/account" state={{ returnTo: location.pathname }}>Save restaurant</Link>;
  const saved = state.status === "ready" && state.data.items.some(row => row.slug === slug);
  async function toggle() {
    setBusy(true);
    try { await (saved ? removeFavorite(slug) : saveFavorite(slug)); reload(); }
    catch (error) { toast.show(errorMessage(error), "danger"); }
    finally { setBusy(false); }
  }
  return <Button variant="secondary" aria-pressed={saved} busy={busy} disabled={state.status === "loading"} onClick={() => void toggle()}>{saved ? "Saved restaurant" : "Save restaurant"}</Button>;
}
