# Location maps

LeafletMap loads only when a location form opens. Leaflet is pinned to 1.9.4.
It uses the standard HTTPS OpenStreetMap tile URL with visible attribution.
There is no bulk downloading or server-side proxy. The only address lookup is reverseGeocode.ts, used by the
owner's location form: one OpenStreetMap Nominatim reverse request, made (debounced) after the owner places or drags
the pin. It fills an empty address, or one it filled itself, and never overwrites an address the owner typed. A failure
leaves the field for typing. The production CSP in vercel.json (connect-src) must also allow
https://nominatim.openstreetmap.org before this works on the live site; that is a deployment decision for Martim.
Tiles follow normal browser caching and override the page referrer policy
with strict-origin-when-cross-origin, sending only the site origin to OSM.

The map starts in Lisbon at zoom 13. Clicking places a draggable div-icon pin.
The controlled point and coordinate fields stay in sync. Without tiles, fields
still work. Geolocation belongs to the form and is requested only on a click.
The map cleans up its Leaflet instance on unmount. Numeric fields provide the
keyboard alternative to clicking/dragging. No device location is requested by
this component.

Sources: https://leafletjs.com/reference-1.9.4.html and
https://operations.osmfoundation.org/policies/tiles/ . The actual hosted
Referer/CSP behavior still needs a deployment check; no deployment is authorized.

ResultsMap supplies the public discovery and restaurant maps. Leaflet positions
the pins and canvases. DiscoveryBasemap draws the land, water, parks, buildings
and roads from OpenFreeMap vector tiles. It requests only visible tiles and aborts
requests when Leaflet unloads them. The land is drawn without text; the names are a separate overlay (below). The public page footer
credits OpenMapTiles and OpenStreetMap. When tiles fail, the numbered diagram
and the list still give diners access to the results.

DiscoveryBasemap stays sharp at every zoom. The tile server stores nothing finer than zoom 14, so past that each tile is cut
from its parent (tileSource.sourceTile) and the vector geometry is redrawn larger on the canvas, instead of stretching the
picture (Leaflet's maxNativeZoom would blur it). Road and water widths grow gently with zoom (strokeGrowth). Parent tiles are
shared between the tiles cut from them, so one download serves many.


Names on the map (discoveryLabels.ts, mapLabels.ts): main areas (districts and neighbourhoods, in small letter-spaced capitals), the
city, rivers and the sea, parks, places worth finding (monuments, museums, castles, viewpoints, theatres...) and streets. They come from
the same OpenFreeMap tiles (the place, water_name, waterway, park, poi and transportation_name layers) and are laid out once over the
whole view, not tile by tile: pieces of a street cut at tile edges are stitched together, a name never overlaps another, the same name
is not repeated close by, and street names follow the street. Smaller things appear as the map is zoomed in (labelStyle gates each
class by zoom, and the poi layer by its importance rank within the tile; artworks and the like are never named). The text has a halo
in the colour of the land so it reads as part of the map. The owner's location map (LeafletMap) uses the OpenStreetMap raster tiles,
which already carry names.

Smoothness (discoveryBasemap.ts): a stored tile is decoded once and kept (40 tiles); each shape keeps its outline as a Path2D and its
bounding box, so redrawing a tile skips decoding and every shape that is off screen (this matters most when zoomed in past the stored
detail, where many canvas tiles are cut from one parent). Tiles for the in-between zoom steps are not drawn (updateWhenZooming:
false) and more tiles are kept around the view (keepBuffer 3). Names are worked out once per stored tile and zoom.

Wheel zoom: ResultsMap uses Leaflet's own wheel zoom with zoomSnap 0 (the zoom follows how far the wheel or trackpad moves, like other
maps; with whole-level snapping a trackpad swipe jumped several levels). The map can therefore sit at a part-way zoom: the basemap
scales its tiles, and DiscoveryLabels picks names for the nearest whole zoom and places them at the real scale.
