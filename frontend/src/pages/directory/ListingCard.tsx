// One real venue from the directory. Only what OpenStreetMap states is shown; the one
// main action opens the organiser space with this venue named.
import { Link } from "react-router-dom";
import type { Listing } from "../../api/venueDirectory";
import { illustrativeFor } from "../../data/illustrativePhotos";
import type { IllustrativePhoto } from "../../data/illustrativePhotos";
import { venuePhoto } from "../../data/venuePhotos";
import { placeLine, planHref, safeWebsite } from "./directoryModel";

/**
 * The photo on top of a card: the venue's own (venuePhotos.ts) or, failing that, an
 * illustrative one. The grid passes `illustrative` (illustrativeLayout) so neighbours differ.
 */
export function cardPhoto(listing: Pick<Listing, "id" | "kind">, illustrative?: IllustrativePhoto): { src: string; alt: string; illustrative: boolean } {
  const own = venuePhoto(listing.id);
  if (own) return { src: own.src, alt: own.alt, illustrative: false };
  // A stock picture never stands in for the venue: alt="" and the visible label say what it is.
  return { src: (illustrative ?? illustrativeFor(listing.kind, listing.id)).src, alt: "", illustrative: true };
}

export function ListingCard({ listing, illustrative }: { listing: Listing; illustrative?: IllustrativePhoto }) {
  const website = safeWebsite(listing.website);
  const titleId = `listing-${listing.id}`;
  const photo = cardPhoto(listing, illustrative);
  return (
    <article className="dir-card has-photo" aria-labelledby={titleId}>
      <div className={photo.illustrative ? "dir-card-photo is-illustrative" : "dir-card-photo"}>
        <img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" width={800} height={600} />
        {photo.illustrative && <span className="dir-photo-label">Illustrative photo</span>}
      </div>
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
      Venue data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>, ODbL. Listed for reference: these venues are not SeatPlan partners. “Quinta or estate” is read from the name. Photos from Wikimedia Commons, see <Link to="/credits">photo credits</Link>; a photo labelled “Illustrative photo” is not of that venue.
    </p>
  );
}
