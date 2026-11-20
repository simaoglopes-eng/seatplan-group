# your-account: read me first

`/account`, the one account panel (plan 2026-11-18, decision 5). One sign-up and one sign-in open both
halves of a SeatPlan account: the personal half (guest session: bookings, event seats) and the work half
(organiser session: restaurants, venues, events). `api/account.ts` keeps exactly the sessions an answer
carries and forgets any other left in the tab.

| File | Job |
|---|---|
| `YourAccountPage.tsx` | Signed out: Sign in or Create account (`?mode=create`). Signed in: who, Sign out (both), Booking \| Staff (`?tab=staff`). A missing half explains itself and offers a sign-in |
| `AccountSignIn.tsx` | `POST /account/login`; also used by `/events/staff` |
| `AccountRegister.tsx` | `POST /account/register` (four fields only), then the code step (`POST /guest/verify`); the demo code is shown when the server sends it |
| `BookingPanel.tsx` | `DinerDashboard` (bookings, saved restaurants) and My events (`GET /guest/me`) |
| `StaffPanel.tsx` | `GET /account/work`: restaurants, event venues, events, with role badges; restaurant owners get Profile, Floor plan, Team, Publishing; event venue owners get Team. "Restaurant owner area" only for someone who owns a restaurant, else "Open your own restaurant" |

A 401 on a guest call is forgotten by `client.ts`; a 401 on `/account/work` is forgotten here
(`clearSessionToken`), so the page shows "Sign in again" instead of a broken panel. The older pages
(`/restaurants/account`, `/my`) stay and link here; every Sign out, theirs and the owner menu's, uses
`accountSignOut` and forgets both sessions.
