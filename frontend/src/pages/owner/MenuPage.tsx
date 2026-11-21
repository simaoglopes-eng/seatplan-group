import { useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { getOwnerMenu, saveOwnerMenu } from "../../api/menus";
import type { MenuItem, RestaurantMenu } from "../../api/menus";
import { getOwnerProfile } from "../../api/owner";
import { Button, Checkbox, ErrorState, Field, Skeleton, useToast } from "../../design/components";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { euroCents } from "./menuPrice";
import { OwnerShell } from "./OwnerShell";

export default function MenuPage() {
  const { venueId = "" } = useParams();
  const { state, reload } = useLoad(async () => {
    const [profile, menu] = await Promise.all([getOwnerProfile(venueId), getOwnerMenu(venueId)]);
    return { profile, menu };
  }, venueId);
  return <OwnerShell title="Menu and prices" venueId={venueId} current="menu" venueName={state.status === "ready" ? state.data.profile.name : undefined}>
    <h1>Menu and prices</h1>
    <p>Add dishes with their prices in euros. Available dishes appear on your public page.</p>
    {state.status === "loading" && <Skeleton lines={4} label="Loading menu" />}
    {state.status === "error" && <ErrorState title="Could not load menu" message={errorMessage(state.error)} onRetry={reload} />}
    {state.status === "ready" && <MenuEditor key={venueId} venueId={venueId} initial={state.data.menu} onReload={reload} />}
  </OwnerShell>;
}

type DraftItem = MenuItem & { price: string; key: number };
function MenuEditor({ venueId, initial, onReload }: { venueId: string; initial: RestaurantMenu; onReload: () => void }) {
  const [version, setVersion] = useState(initial.version);
  const [items, setItems] = useState<DraftItem[]>(() => initial.items.map((item, key) => ({ ...item, key, price: (item.price_cents / 100).toFixed(2) })));
  const [nextKey, setNextKey] = useState(items.length);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const change = (index: number, fields: Partial<DraftItem>) => setItems(items.map((item, i) => i === index ? { ...item, ...fields } : item));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (items.some(item => euroCents(item.price) === null)) { setProblem("Use a valid euro price with up to two decimals, for example 12,50."); return; }
    setBusy(true);
    setProblem(null);
    try {
      const menu = await saveOwnerMenu(venueId, { version, items: items.map(({ key: _key, price, ...item }) => ({ ...item, price_cents: euroCents(price)! })) });
      setVersion(menu.version);
      toast.show("Menu saved.", "success");
    } catch (error) { setProblem(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={event => void save(event)}>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      {items.map((item, index) => <fieldset key={item.key} className="rb-card" style={{ marginBlock: "1rem" }}>
        <legend>Dish {index + 1}</legend>
        <Field label="Dish name" required maxLength={120} value={item.name} onChange={event => change(index, { name: event.target.value })} />
        <Field label="Category" required maxLength={60} value={item.category} onChange={event => change(index, { category: event.target.value })} />
        <Field label="Description" maxLength={500} value={item.description} onChange={event => change(index, { description: event.target.value })} />
        <Field label="Price (€)" required inputMode="decimal" value={item.price} onChange={event => change(index, { price: event.target.value })} />
        <Field label="Allergens" maxLength={500} value={item.allergens} onChange={event => change(index, { allergens: event.target.value })} />
        <Checkbox label="Available on the public menu" checked={item.available} onChange={event => change(index, { available: event.target.checked })} />
        <Button variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove dish {index + 1}</Button>
      </fieldset>)}
      <Button variant="secondary" disabled={items.length >= 100} onClick={() => { setItems([...items, { key: nextKey, name: "", category: "Menu", description: "", price: "", price_cents: 0, allergens: "", available: true }]); setNextKey(nextKey + 1); }}>Add dish</Button>
    </fieldset>
    {problem && <p role="alert">{problem} <Button variant="ghost" disabled={busy} onClick={onReload}>Reload saved menu</Button></p>}
    <p><Button type="submit" busy={busy}>Save menu</Button></p>
  </form>;
}
