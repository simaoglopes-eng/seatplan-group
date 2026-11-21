// The three room tiles on the home page, each a slow cross-fade through three real
// directory venues of that kind (photos in public/images/venues, credited on /credits).
// One shared clock ticks every 5/3 s and moves one tile at a time, so each tile changes
// every 5 s and never together with its neighbours. The photos are decorative (the tile
// says what it opens); the venue name sits small in a corner so nobody mistakes one
// place for another. Under reduced motion the first photo stays, with no clock at all.
import { useEffect, useState } from "react";
import type { DirectoryKind } from "../../api/venueDirectory";
import { HOME_TILE_VENUES, venuePhoto } from "../../data/venuePhotos";
import { COUNTRIES } from "../directory/directoryModel";
import { useReducedMotion } from "./useMotion";
import { useTabVisible } from "./HeroSlides";

export interface RoomPhoto {
  /** Directory listing id (n/w/r + OpenStreetMap id), the key of VENUE_PHOTOS. */
  id: string;
  src: string;
  name: string;
  /** Country name in words, e.g. "Italy". */
  country: string;
}

/** Three listing ids per kind (venuePhotos.ts, so /credits can say where each is shown). */
const ROOM_VENUES = HOME_TILE_VENUES;

/** The photos of one kind, in order; an id missing from VENUE_PHOTOS is left out rather than guessed. */
export function roomPhotos(kind: DirectoryKind): RoomPhoto[] {
  return (ROOM_VENUES[kind] ?? []).flatMap((id) => {
    const photo = venuePhoto(id);
    if (!photo) return [];
    const country = COUNTRIES.find((c) => c.key === photo.country)?.label ?? photo.country;
    return [{ id, src: photo.src, name: photo.name, country }];
  });
}

/** Each tile holds a photo for SLIDE_EVERY_MS; the clock moves one tile per tick. */
export const SLIDE_EVERY_MS = 5000;

/**
 * One clock for all the tiles: tick n advances tile n % tiles, so with three tiles each
 * one changes every SLIDE_EVERY_MS, a third of that apart from the next.
 */
export function useRoomSlides(tiles: number, perTile: number): number[] {
  const reduced = useReducedMotion();
  const visible = useTabVisible();
  const [shown, setShown] = useState<number[]>(() => Array.from({ length: tiles }, () => 0));
  useEffect(() => {
    if (reduced) setShown(Array.from({ length: tiles }, () => 0));
  }, [reduced, tiles]);
  useEffect(() => {
    if (reduced || !visible || tiles < 1 || perTile < 2) return undefined;
    let tick = 0;
    const timer = window.setInterval(() => {
      const tile = tick % tiles;
      tick += 1;
      setShown((prev) => prev.map((n, i) => (i === tile ? (n + 1) % perTile : n)));
    }, Math.round(SLIDE_EVERY_MS / tiles));
    return () => window.clearInterval(timer);
  }, [reduced, visible, tiles, perTile]);
  return shown;
}

/** The stacked photos of one tile and the caption of the one on show. */
export function TileSlides({ photos, index }: { photos: RoomPhoto[]; index: number }) {
  const on = photos[index] ?? photos[0];
  return (
    <>
      <span className="ld-tile-slides" aria-hidden="true">
        {photos.map((p, i) => (
          <img
            key={p.id}
            className={i === index ? "is-on" : undefined}
            src={p.src}
            width={1400}
            height={933}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ))}
      </span>
      {on && (
        <span className="ld-tile-venue" aria-hidden="true" key={on.id}>
          {on.name}, {on.country}
        </span>
      )}
    </>
  );
}
