// One real venue from the directory. Only what OpenStreetMap states is shown; the one
// main action opens the organiser space with this venue named.
import { Link } from "react-router-dom";
import type { Listing } from "../../api/venueDirectory";
import { placeLine, planHref, safeWebsite } from "./directoryModel";

export function ListingCard({ listing }: { listing: Listing }) {
  const website = safeWebsite(listing.website);
  const titleId = `listing-${listing.id}`;
  return (
    <article className="dir-card" aria-labelledby={titleId}>
      <p className="ep-type">{listing.kind_label}</p>
      <h3 id={titleId}>{listing.name}</h3>
      <p className="dir-place">{placeLine(listing)}</p>
      {listing.street && <p className="dir-street">{listing.street}</p>}
      <div className="dir-actions">
        <Link className="btn btn-primary" to={planHref(listing)}>
          Plan an event here<span className="visually-hidden">: {listing.name}</span>
        </Link>
        {website && (
          <a className="dir-link" href={website} target="_blank" rel="noopener noreferrer nofollow">
            Website<span className="visually-hidden"> of {listing.name} (opens in a new tab)</span> <span aria-hidden="true">↗</span>
          </a>
        )}
        <a className="dir-link" href={listing.source_url} target="_blank" rel="noopener noreferrer">
          Map<span className="visually-hidden"> of {listing.name} on OpenStreetMap (opens in a new tab)</span> <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

export function Attribution() {
  return (
    <p className="dir-attribution">
      Venue data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>, ODbL. Listed for reference: these venues are not SeatPlan partners. “Quinta or estate” is read from the name.
    </p>
  );
}
