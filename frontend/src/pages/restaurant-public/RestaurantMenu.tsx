import { getPublicMenu } from "../../api/menus";
import { Button } from "../../design/components";
import { useLoad } from "../restaurant/useLoad";

export function RestaurantMenu({ slug }: { slug: string }) {
  const { state, reload } = useLoad(() => getPublicMenu(slug), slug);
  const currency = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  return <section className="rb-card" aria-labelledby="restaurant-menu-title">
    <h2 id="restaurant-menu-title">Menu and prices</h2>
    {state.status === "loading" && <p role="status">Loading menu…</p>}
    {state.status === "error" && <p>Could not load the menu. <Button variant="ghost" onClick={() => reload()}>Try again</Button></p>}
    {state.status === "ready" && (state.data.items.length === 0 ? <p>The restaurant has not added a menu yet.</p> : <>
      {[...new Set(state.data.items.map(item => item.category))].map(category => <div key={category}><h3>{category}</h3>
        <dl>{state.data.items.filter(item => item.category === category).map((item, index) => <div key={`${item.name}:${index}`} style={{ marginBlock: "1rem" }}>
          <dt><strong>{item.name}</strong> · {currency.format(item.price_cents / 100)}</dt>
          {item.description && <dd>{item.description}</dd>}
          {item.allergens && <dd>Allergens: {item.allergens}</dd>}
        </div>)}</dl>
      </div>)}
      <p className="rb-muted">For food allergies, confirm ingredients and preparation directly with the restaurant.</p>
    </>)}
  </section>;
}
