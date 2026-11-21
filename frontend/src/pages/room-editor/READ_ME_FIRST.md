# Restaurant room editor

This editor owns restaurant rooms and uses centimetres with screen y down.
The event editor remains the compatibility reference. Only its existing
useHistory and useUnsavedGuard hooks are imported when the UI is introduced.

roomModel.ts defines the nested room payload and immutable room operations.
Every added item has a browser key of at most 39 characters, with a nullable
database id. Persisted ids must be preserved when moving and editing items.

geometry.ts matches the Python ambience geometry. Clockwise outlines have
positive signed area. Each point's curve is the signed outgoing sagitta.
The polygon uses 16 segments per circular side by default. Boundary points
are inside. Server validation remains authoritative at save and publish.

Why immutable values? Each history entry can retain the previous object.
Why room-local coordinates? Each room has independent walls and orientation.
Why two geometry implementations? Browser gestures and server validation need
the same conventions. Known reference cases are tested in both languages.

Run npm test -- src/pages/room-editor/geometry.test.ts and npm run typecheck.

RoomEditorPage starts the room history and accessible properties. RoomCanvas
uses the shared pan/zoom hook, centimetre grid and rulers. NewRoomDialog and
shapeModel create rectangles, L-shaped rooms and freehand outlines. Every
gesture for adding a corner also has x/y fields and a button. The legacyRoom
adapter reads the existing flat restaurant layout into an implicit Main room
without changing any database id. The later persistence tasks replace that
bootstrap with the dedicated versioned room API.

shapeEditing.ts edits corners and circular sides without changing prior history.
Splitting an arc keeps both halves on the original circle. A split across an
opening or a removal beside an opening is refused until the opening is moved.
The owner sees that explanation rather than losing window data. Drawing ignores
repeat taps and finishOutline normalises winding and remaps opening offsets.

ShapeHandles provides 44px pointer targets independent of zoom. One drag is one
history step. A single midpoint tap adds a corner after the double-tap interval;
a double tap straightens the wall. RoomProperties exposes the same edits as
forms, with decimal comma or point and visible validation errors. SVG paths use
true circular A segments. The properties heading receives focus without
scrolling the canvas away during a drag.

wallModel.ts creates and validates openings, checks overlap and bounds in arc
centimetres, and computes the bearing from the outward normal at the opening
midpoint. WallTools exposes the same controls as WallLayer's move/resize
handles. Windows have view text, up to three tags, top height and a sun rule;
doors have the entrance flag. Glass occupies the entire side and follows side
length edits. Shape changes which would strand a window beyond the wall are
refused. Opening ids/keys survive edits. Photo attachment joins the upload
and saved-room endpoints in tasks 13/17, after an opening has a database id.

North is always the top of the plan. NorthCompass is a small fixed mark (outlined circle, arrow, N) in the top right
corner of the plan; it is transparent, takes no clicks and never turns, and there is no North tab or field. New rooms
get north_deg 0, and the editor opens every room through withNorthUp, so a room the server holds with another north
(or none) shows as Unsaved until it is saved with north 0. Save replaces north with 0 for every room. The window
directions and the publish check all use that 0. northModel.compassNorth is kept for a future phone
compass, and validation still reports no_north for a room that reaches it without one.
The phone must lie flat and align with the plan; the owner checks the result.
Manual controls remain available when no sensor reading arrives. API reference:
https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent and
https://www.w3.org/TR/orientation-event/ . Physical iOS/Android hardware has
not been tested in this Windows session.

roomObjects.ts owns immutable fixed-element and zone creation/editing. The
eleven fixture kinds and seven new zone kinds are listed there. Existing
stage zones remain readable/editable for compatibility. Circles keep equal
dimensions; changes preserve ids and keys. Removing a zone clears that link
on affected tables and preserves every table. FixtureTools/ZoneTools expose
palettes, placement in the room and position/size/name fields. Palette drag
uses a private MIME type; tap-then-place and the placement button also work.
ObjectLayer draws neutral icons/names and allows one-step drag undo. Zone
rectangles are behind fixtures and tables and are selectable in the Fixed tool (there is no Zones tab).
Outline containment and overlap warnings are added by task 16; placement can
currently be outside.
All values use centimetres and clockwise screen rotation.

Desktop properties scroll independently within the canvas height, so dragging
from a long palette does not scroll the page out from under the pointer.
Zone names retain the historical 80-character limit, including during moves.

tableModel.ts creates round/square/long/counter tables with the specified sizes
and chair counts. It imports the existing seatPositions helper without changing
it. Counters use the first side of a rectangle with twice the requested count,
so all chairs sit on one long side and span the counter width. Editing geometry
keeps chair ids/labels/flags and rotates custom displacements relative to the
generated chair positions. Changing chair count redistributes chairs explicitly,
retaining the first existing ids/keys and custom labels/flags. Chairs are 30 cm
across; a square table has chairs on all four sides. Party sizes are no longer
edited: minimum is 1 and maximum follows the chair count. A room allows 200 tables/1000 chairs; each table 1–20.

TableTools exposes the table palette, the selected table, its chair count (+/-) and
its zone, and, when the room has a terrace, a "Put new tables" choice (inside / on a
terrace). Tables cannot be resized by hand and there are no label, geometry,
party-size, availability, wheelchair, high-chair, join-group or per-chair fields
and no batch selection panel (SelectionTools is gone). The selection helpers in
selection.ts remain for the keyboard shortcuts.
TableLayer selects and drags tables or individual chairs with one history step.
Chair drag uses centimetres, table drag the optional room grid. Inactive tables
have dashed outlines and an (off) label. Accessible/blocked chairs have extra
marks, not only colour. Task 15 adds transforms/multiple selection/shortcuts;
task 17 enforces persisted booking references on the server before deletion.

selection.ts implements table bounds (circles ignore rotation), group movement,
six alignments, even gaps on either axis, duplication with fresh table/seat ids
and keys, conservative deletion, rotation and anchored corner resizing. A
duplicate keeps settings/labels for chairs and gets a unique table copy label.
Negative distribution gaps are refused until the outer tables are further apart.
has_bookings is read-only server metadata: unknown persisted tables cannot be
deleted; task 17 must provide it and strip it from write payloads.

Shift-click adds tables; touch hold enters multiple mode. Arrows move
1 cm (Shift 10), R rotates 15, Ctrl/Meta+D duplicates, Delete removes selected
tables, Escape clears. Shortcuts ignore form inputs. A selected chair moves by
arrows; Delete asks for the chair-count controls to avoid deleting the table.
TableHandles rotates in 15-degree steps (Alt gives free angles); there is no resize grip. Table body hit areas take priority over expanded
chair targets within the body. Touch targets, numeric forms and checkbox lists
provide alternatives; task 20 completes the phone workspace and camera behavior.

validation.ts mirrors ambience/validation.py with known reference cases in both
test suites. validateRooms returns RoomProblem values; publication mode adds
no_north and no_tables. The editor memoizes draft checks on layout changes.
ProblemList lists all rooms, not just the current one, and clicking a problem
selects its target and centres the camera/viewport. Error tables have a red
outline and warning glyph, and invalid outlines are red. Invalid drafts remain
renderable and editable; unfinished outlines offer Continue drawing walls.
SAT checks use actual circles/rotated rectangles; chair-clearance footprints add
45 cm. Circle corners are not treated as rectangle corners. Concave containment
checks boundary crossings as well as centres/corners. Groups allow 2 cm overlap;
touching edges alone have no area overlap. The whole restaurant editor is lazy
loaded so other routes do not load these geometry/interaction modules eagerly.


## Saving and recovery (task 18)

The editor opens what the server has (`GET /api/owner/restaurants/{vid}/rooms`, a
restaurant without rooms arrives as one implicit "Main room") and Save replaces the whole
layout in one request (`api/rooms.ts`, `useRoomDraft.ts`). The request carries the
version the layout was opened at; if another tab or device saved first the server
answers 409 `stale_layout` and changes nothing. The owner's work then stays on screen and
on this device (localStorage `seatplan.room-draft.<venue>`, written 400 ms after each
change, removed on save), with two choices: "Discard mine and load the latest" or "Save
mine over it" (rebased on the latest version; if something it refers to was deleted
elsewhere the server says 404 and the owner is told to load the latest). A draft left from
an earlier visit is offered back ("Restore my changes" / "Discard my changes") and is never
overwritten before that choice. A table with bookings cannot be deleted (409 with its name):
the message points to "Available for booking" instead. Storage errors (private windows) only
mean no local copy; the editor still works.
Final review adds structural checks when reading local drafts: damaged stored
JSON shapes are ignored so the saved server rooms can still open. A room save
that moves a published restaurant to draft explains that new bookings are
closed until the owner fixes the problems and publishes again. Area checks
mirror the server's inclusive 4–5000 m² limits. Server winding normalization
preserves opening positions and curves. The full phone persistence test now
uses real tap actions with hasTouch/isMobile, not mouse clicks at a small width.

There is no Light tool: the owner does not choose or preview the sun. A diner sees the sun when choosing a table, worked out by the server from the saved rooms, the north (always the top of the plan) and the windows. The editor kept none of the preview code (LightTools, LightLayer, useLightPreview, lightModel were removed); the backend ambience endpoints are untouched.

The room's name is shown, not edited, in Room properties (`Room: <name>`); it is set when the room is created in the Add a room dialog.

Around the room (AroundRoom.tsx, surroundings.ts), at the top of the Walls tab: for a chosen wall the owner says what is outside it (Sea, River, Park, Street, City, Hills). No API field was added: it is stored as the view of a window on that wall (`view_tags` sea/river/garden/street/city/hills and a few words), which setSurrounding adds when the wall has none. The diner's plan already reads those views, so water and parks are drawn there too. The editor draws a labelled strip outside each such wall (RoomCanvas, `data-room-view`, surroundingBands). "Suggest from my location" reads the restaurant's pin (getOwnerProfile) and the OpenFreeMap tiles around it (maps/nearbyFeatures.ts: water, waterways and parks within 600 m, with the direction of each), then offers the wall that faces each one (wallFacing). The tile server is the one the discovery map already uses; nothing is sent but the tile addresses.


Terrace: a terrace is a zone of kind terrace (so diners can filter for one) created from the
"Terrace outside this wall" checkbox in Around the room (surroundings.ts: setTerrace, terraceOn). It is a
250 cm strip outside the chosen wall; the wall's view band is drawn beyond it. Tables may stand
wholly inside a terrace zone even though it is outside the walls (validation.ts), and
assignTerraceTables (run by changeRoom) puts them in its zone. Terrace is no longer in the Fixed palette;
an existing terrace zone is still editable there.

Metre marks: RoomCanvas draws them on a strip along the top and left edge of the view (screen space, not plan
space), so they never lie on a shape. Their spacing follows the zoom (every 1, 2, 5, 10... m, at least 56 px apart),
and the left ones stay clear of the zoom buttons.

Later changes: the metre marks start at 0 m on the room's top-left corner and never go negative. The tab row is
Shape, Walls, Fixed, Tables (last); there is no separate "Add table" button, the table palette is the "Add a table"
section of the Tables tab. The footer shows the area and only layout errors (ProblemList); warnings, tips and the
"Grid on" text are not shown.

Less text, fewer controls: the panels carry almost no instructions (only where an action is not obvious). The Shape panel has no
"Selected corner" list, "Bulge" field or "Make straight" button: corners are chosen on the plan and a wall is bent by dragging its
midpoint (under 12 cm of bulge snaps to straight; a double tap also straightens). The Fixed panel has no "Rename label" or
"Rotate 90°": elements turn with the grip on the plan.

Walls tab: one "Wall" chooser (in Around the room) drives the terrace and the Add window / Add door buttons; there is no separate
"Wall for opening". Openings have a width field but no offset field (drag along the wall). The terrace is an "Add terrace" button
(a rectangular terrace zone flush against a straight wall, 250 cm deep; surroundings.ts setTerrace / setTerraceSize / terraceSize);
in the Walls tab terrace zones are selectable and show the zone grips so their sides can be pulled, and the panel has Terrace
width / Terrace depth fields and Remove terrace. A terrace on a sloping wall is turned to match it: zones are saved without a rotation, so terraceGeometry.ts derives the angle from the wall the terrace lies against (the saved box is the unturned one) and draws, validates and assigns tables with the turned box. Curved walls use their chord.

Window properties show only the opening width (no top height, view text, view tags, night view, view photo link or sun setting). The
view of a window is still set from Around the room; the sun rule keeps its default "auto".

Way forward: the footer has a primary button "Continue to review" (RoomEditorPage). With unsaved changes it reads "Save and continue to
review", saves, and goes to /owner/:venueId/review only if the save worked (otherwise the notice shows and the page stays).
