# Restaurant owners

OwnerSignUpPage handles the emailed-code registration flow. The session is
stored only after verification succeeds. OwnerHomePage loads private cards
through api/owner.ts. Owner sign-in reuses Login with /owner as its default
destination. Existing event and staff login destinations retain their defaults.

The page uses the shared design tokens and components. Account endpoints reject
unknown fields and the server controls ownership, publication and setup progress.

Why separate owner and guest accounts? Owners use organiser sessions, which are
accepted by the existing staff tools. Guest account sessions have another format.

Can hiding another owner's card enforce privacy? The API filters by owner id
and applies the same 404 rule at resource endpoints. The UI only displays it.

When is a demo code shown? Only when the server's existing demo checks permit
it. The UI renders code_shown if present and always supports emailed codes.

NewRestaurantWizard saves identity before switching to location. The setup URL
uses the new public id, and a reload resumes from persisted identity. ProfilePage
edits identity/location for existing restaurants. Draft cards offer Continue setup.
The wizard session key follows the loaded profile id, avoiding stale initial
state when /owner/new changes to the saved URL. Slugs are editable only in drafts.
The next upload/hours/room/review steps join this flow in their own plan tasks.

ProfileForms contains the address, coordinate fields and the pin; placing the pin fills an empty address (never one the owner typed); Leaflet is
lazy loaded. Server validation is authoritative for URLs, cuisines and timezones.
Client controls prevent over three cuisines and count description characters.

PhotoEditor manages gallery and optional saved-window view photos. photoResize
rejects unsupported or >15 MB originals, flattens onto white, encodes JPEG at
quality .82 within 1600 px, retries within 1200 px if needed, and refuses a
result over 800000 bytes. PhotoPreview fetches bytes with the owner session,
creates a blob URL and revokes it on unmount/change. Draft card covers use the
same authenticated component. The API lives in api/photos.ts. Uploads and
gallery reordering work by drag/drop or ordinary keyboard-operable controls.
Window links are available after the opening has a saved database id; before
that the owner is told to save the room. Task 17 completes that persistence.


## Opening hours and publishing (task 19)

`HoursPage.tsx` (`/owner/:venueId/hours`) wraps the staff schedule editor and, for a restaurant with no services,
offers "Lunch 12:00-15:00 and Dinner 19:00-23:00, Tuesday to Sunday" (`hoursTemplate.ts`) behind a "Use this"
button. `PublishReview.tsx` (`/owner/:venueId/review`) shows the seven-row checklist (`publishChecklist.ts`) from
`GET .../publish-check`: every row says Done, To do or Recommended in words next to its mark, with a link to fix
it. Publish is off until every required row is done, and the server checks again and may still answer 422 with
the problems, which the page lists. A published restaurant shows "View public page" and Unpublish.

## Team (events parity, 2026-11-18)

`TeamPage.tsx` (`/owner/:venueId/team`, "Team" in the shell's lower menu) lists the members, adds one by
email and removes one after a dialog (`GET|POST|DELETE /owner/venues/{vid}/members`, in `api/account.ts`).
The server never says whether an email has an account, so the page only explains that the person needs
one with that address. A 404 means "not your restaurant". The same page serves an event venue (hall or
quinta) its owner reaches from Staff on `/account`: no restaurant profile answers for that id, so the
page finds the venue in `GET /account/work`, shows its name and venue words, and leaves out the
restaurant shell and steps (a plain page with "Back to your account").
