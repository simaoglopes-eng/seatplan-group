# pay: read me first

## Purpose

The two pages of a deposit payment. A diner whose booking needs a deposit is sent here from the booking
flow, pays, and comes back to a page that says how it went. The routes sit under `/pay`, which the shell
treats as part of the Restaurants look (`design/components/PageShell.tsx`).

| File | One job |
|---|---|
| `DemoCheckoutPage.tsx` | `/pay/demo/:paymentId`. The pretend payment page: "Pay (demo)", "Simulate a declined card", "Give up". Says in words that no money moves. It exists only while the server's provider is the demo one |
| `PaymentReturnPage.tsx` | `/pay/return/:paymentId`. Where every payment page (this one or Stripe's) sends the diner back. Asks the server where the payment stands, keeps asking for about a minute, and shows the confirmation only when the server says it is paid |
| `pendingBooking.ts` | Keeps the booking's manage link in this tab while the diner is away paying |
| `pay.test.tsx` | Tests of both pages and of the tab memory |

## Likely walkthrough questions

**Why does the address carry only the payment id, never the manage link?**
The payment page belongs to another company (Stripe). Anything in the address it is sent could end up in
its logs, and the manage link is the only key to the booking. So the tab keeps the link in
`sessionStorage` (gone when the tab closes) and the return page reads it from there. With storage blocked
the page still works; it then points to the link in the confirmation email.

**Why does the return page keep asking instead of trusting the address?**
A payment provider can take a moment to confirm, and anyone can type `/pay/return/<id>`. The server is
the only source of truth: the page says "Booking confirmed" only after `GET /payments/<id>` says `paid`.
