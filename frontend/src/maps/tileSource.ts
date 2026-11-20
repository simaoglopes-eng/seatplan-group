/** The tile server the maps read from (OpenFreeMap vector tiles). */
export const TILE_URL = "https://tiles.openfreemap.org/planet/latest";

export interface TileCoords { x: number; y: number; z: number }
export interface TileSource { z: number; x: number; y: number; scale: number; offsetX: number; offsetY: number }

/**
 * Which stored tile holds the map for tile `coords`. Past `nativeZoom` there is nothing finer to download, so the
 * tile is cut from its parent: `scale` is how many times bigger the parent's drawing is made, and `offsetX/offsetY`
 * (0 to scale - 1) say which part of it this tile shows. Vector tiles are redrawn at that size, so they stay sharp.
 */
export function sourceTile(coords: TileCoords, nativeZoom: number): TileSource {
  if (coords.z <= nativeZoom) return { ...coords, scale: 1, offsetX: 0, offsetY: 0 };
  const scale = 2 ** (coords.z - nativeZoom);
  const x = Math.floor(coords.x / scale), y = Math.floor(coords.y / scale);
  return { z: nativeZoom, x, y, scale, offsetX: coords.x - x * scale, offsetY: coords.y - y * scale };
}

/** Roads and water grow a little with each zoom past the stored detail, but far less than the map itself does. */
export function strokeGrowth(zoom: number, nativeZoom: number): number {
  return zoom > nativeZoom ? 1 + 0.4 * (zoom - nativeZoom) : 1;
}
