// The map of search results: one pin per restaurant, the highlighted one
// drawn larger. Like LeafletMap it creates the Leaflet map in an effect and
// removes it on unmount; there is no react-leaflet. Pins are real buttons
// (Leaflet keyboard support), and the list next to the map is the accessible
// way to reach every restaurant, so the map itself adds nothing a keyboard needs.
import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DiscoveryBasemap } from "./discoveryBasemap";
import { DiscoveryLabels } from "./discoveryLabels";
import { SchematicMap } from "./SchematicMap";
import "./maps.css";
export interface ResultPin {
  number?: number;
  id: string;
  name: string;
  lat: number;
  lng: number;
}
interface Props {
  pins: ResultPin[];
  highlightedId?: string | null;
  selectedId?: string | null;
  /** A new request for every explicit card click, including repeat clicks on the same card. */
  centerRequest?: { id: string } | null;
  onSelect?: (id: string) => void;
  showNames?: boolean;
  /** Where the diner searched from, shown as a small dot. */
  center?: { lat: number; lng: number } | null;
  /** Tells the page when the tiles failed and a numbered diagram took the map's place, so cards can show the same numbers. */
  onFallback?: (active: boolean) => void;
}
// If no tile has loaded after this long (or the browser is offline), the map is replaced by a diagram.
const TILE_PATIENCE_MS = 6000;
const LISBON = { lat: 38.7223, lng: -9.1393 };
const INITIAL_ZOOM = 11;
const RESTAURANT_ZOOM = 14;
const MIN_ZOOM = 0;
const MAX_ZOOM = 19;
function locationIcon(name: string) {
  const label = document.createElement("span");
  label.className = "restaurant-location-label";
  label.textContent = name;
  return L.divIcon({ className: "restaurant-location-pin", html: label, iconSize: [14, 14], iconAnchor: [7, 7] });
}

export default function ResultsMap({ pins, highlightedId = null, selectedId = null, centerRequest, onSelect, center, onFallback, showNames = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const select = useRef(onSelect);
  select.current = onSelect;
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const tell = useRef(onFallback);
  tell.current = onFallback;
  useEffect(() => tell.current?.(fallback), [fallback]);
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, {
      scrollWheelZoom: true,
      zoomSnap: 0, // the zoom follows how far the wheel or trackpad is moved, instead of jumping whole levels
      wheelPxPerZoomLevel: 28,
      attributionControl: false,
      zoomControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    }).setView(LISBON, INITIAL_ZOOM);
    view.on("zoomend", () => setZoom(view.getZoom()));
    map.current = view;
    const tiles = new DiscoveryBasemap();
    let loaded = 0;
    tiles.on("tileload", () => {
      loaded += 1;
      setFallback(false);
      setFailed(false);
    });
    tiles.on("tileerror", () => setFailed(true));
    tiles.addTo(view);
    new DiscoveryLabels().addTo(view); // names of areas, rivers, parks and streets, above the basemap
    const retryTiles = () => { if (loaded === 0) tiles.redraw(); };
    window.addEventListener("online", retryTiles);
    // No tile after a while: show the diagram instead of a grey box. A tile that arrives later brings the map back.
    const patience = window.setTimeout(() => {
      if (loaded === 0) setFallback(true);
    }, TILE_PATIENCE_MS);
    const pinsOnMap = markers.current;
    return () => {
      window.clearTimeout(patience);
      window.removeEventListener("online", retryTiles);
      // A pan or zoom still animating when the map is removed throws inside Leaflet.
      view.stop();
      view.remove();
      map.current = null;
      pinsOnMap.clear();
    };
  }, []);
  // Draw the pins again when the results change, and show them all.
  useEffect(() => {
    const view = map.current;
    if (!view) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current.clear();
    for (const [index,pin] of pins.entries()) {
      const marker = L.marker([pin.lat, pin.lng], {
        title: showNames ? undefined : pin.name,
        alt: `${pin.name} on the map`,
        interactive: !showNames,
        keyboard: !showNames,
        icon: showNames
          ? locationIcon(pin.name)
          : L.divIcon({ className: "discover-pin", html: `<span aria-hidden="true">${pin.number ?? index+1}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
      }).addTo(view);
      if (!showNames) marker.on("click", () => select.current?.(pin.id));
      markers.current.set(pin.id, marker);
    }
    const points: L.LatLngExpression[] = pins.map((pin) => [pin.lat, pin.lng]);
    if (center) points.push([center.lat, center.lng]);
    if (points.length > 1) view.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15, animate: false });
    else if (points.length === 1) view.setView(points[0], RESTAURANT_ZOOM, { animate: false });
  }, [pins, center?.lat, center?.lng, showNames]);
  useEffect(() => {
    const view = map.current;
    const marker = centerRequest && markers.current.get(centerRequest.id);
    if (view && marker) {
      view.setView(marker.getLatLng(), Math.max(view.getZoom(), RESTAURANT_ZOOM), { animate: false });
    }
  }, [centerRequest]);
  // The pin of the hovered card gets a bigger, darker look.
  useEffect(() => {
    if (showNames) return;
    const selected = selectedId && markers.current.has(selectedId) ? selectedId : null;
    const focusedId = highlightedId && markers.current.has(highlightedId) ? highlightedId : selected;
    markers.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle("discover-pin-active", id === highlightedId);
      marker.getElement()?.classList.toggle("discover-pin-selected", id === selectedId);
      marker.getElement()?.classList.toggle("discover-pin-muted", focusedId !== null && id !== focusedId);
      marker.getElement()?.setAttribute("aria-current", id === selectedId ? "true" : "false");
      marker.setZIndexOffset(id === focusedId ? 1000 : 0);
    });
  }, [highlightedId, selectedId, pins, showNames]);
  const changeZoom = (step: number) => {
    const view = map.current;
    view?.setZoom(view.getZoom() + step, { animate: false });
  };
  return (
    <>
      {/* The Leaflet map stays mounted (hidden) while the diagram is shown, so it can recover if tiles arrive. */}
      <div className="discover-map-panel" role="region" aria-label="Map of the restaurants found" hidden={fallback}>
        <div ref={host} className="discover-map" />
        <div className="discover-map-zoom" role="group" aria-label="Map zoom">
          <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)}>+</button>
          <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-1)}>−</button>
        </div>
      </div>
      {fallback && <SchematicMap pins={pins} highlightedId={highlightedId} selectedId={selectedId} onSelect={onSelect} centre={center} showNames={showNames} />}
      {failed && !fallback && <p role="status">Map tiles are loading slowly. The list shows every restaurant.</p>}
    </>
  );
}
