export interface GeoPoint { lat: number; lng: number }

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const MAX_LENGTH = 200;

interface NominatimAddress {
  road?: string; pedestrian?: string; footway?: string; house_number?: string;
  postcode?: string; city?: string; town?: string; village?: string; municipality?: string;
}
interface NominatimReply { display_name?: string; address?: NominatimAddress }

/** Builds "Street 12, 1200-014 Lisboa" from a Nominatim reply, or falls back to its display name. */
export function formatAddress(reply: NominatimReply): string {
  const a = reply.address ?? {};
  const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(" ");
  const place = [a.postcode, a.city ?? a.town ?? a.village ?? a.municipality].filter(Boolean).join(" ");
  const composed = [street, place].filter(Boolean).join(", ");
  return (composed || reply.display_name || "").slice(0, MAX_LENGTH);
}

/**
 * Looks up the address at a pin. One request per call, made only after the owner places the pin
 * or clicks the button (OpenStreetMap's usage policy forbids bulk and as-you-type lookups).
 * Returns null when nothing usable comes back or the request fails; the owner then types it.
 */
export async function reverseGeocode(point: GeoPoint, signal?: AbortSignal): Promise<string | null> {
  const query = new URLSearchParams({ format: "jsonv2", lat: point.lat.toFixed(6), lon: point.lng.toFixed(6), zoom: "18", addressdetails: "1", "accept-language": "en" });
  const response = await fetch(`${ENDPOINT}?${query}`, { signal, referrerPolicy: "strict-origin-when-cross-origin", headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const reply = (await response.json()) as NominatimReply & { error?: string };
  if (reply.error) return null;
  return formatAddress(reply) || null;
}
