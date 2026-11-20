import { listPhotos } from "../../api/photos";
import type { OwnerProfile } from "../../api/owner";
import { useLoad } from "../restaurant/useLoad";
import { PhotoPreview } from "./PhotoPreview";
import { cuisineLabel } from "./ProfileForms";

export function ListingPreview({ venueId, name, profile }: { venueId: string; name: string; profile?: OwnerProfile }) {
  const { state } = useLoad(() => listPhotos(venueId), venueId);
  const photos = state.status === "ready" ? state.data : [];
  const cover = photos.find((photo) => photo.kind === "gallery" && photo.is_cover);
  const context = [
    profile?.cuisines?.map(cuisineLabel).join(", "),
    profile?.price_level ? "€".repeat(profile.price_level) : null,
    profile?.address,
  ].filter(Boolean).join(" · ");
  return (
    <div className="ow-preview">
      {cover
        ? <PhotoPreview className="ow-preview-cover" url={cover.url} alt={cover.alt_text} />
        : <div className="ow-preview-cover ow-preview-empty">{state.status === "loading" ? "Loading cover photo…" : state.status === "error" ? "Cover photo unavailable" : "Add a cover photo"}</div>}
      <h3>{name}</h3>
      {context && <p className="rb-muted">{context}</p>}
      {profile?.description && <p>{profile.description}</p>}
    </div>
  );
}
