# Sign-up: one form for every page that creates an account

Owner decision (2026-11-20): "Same full set everywhere". Every sign-up gets the same pieces from ONE
component, so they cannot drift apart again.

| File | Job |
|---|---|
| `SignUpForm.tsx` | The form step and the emailed-code step. First and last name (one row when they fit), email with its "we email you a code" hint, password with the eye inside the field, the privacy consent with "What we store", then Code, Create my account, Send a new code (30 s wait), Use a different email and the sign-in link |
| `useSignUp.ts` | The state: values, errors, the newest `signup_id`, cooldown, resend, different email. Knows no endpoint |
| `validate.ts` | `validateSignUp`, `joinName`, `MIN_PASSWORD`: the one set of messages |
| `signup.css` | The compact layout, and the `.ap-compact` page chrome that lets a form fit one phone screen |

A page passes: `register` (builds ITS payload and calls ITS endpoint; return `{signupId, sentTo?, demoCode?}`),
`verify`, `onDone`, `copy`, `links`, `nameHint` (one line under the name row, used by `/j` to say who sees the name) and `renderExtra` for a field it truly needs. Endpoints that take one
`name` get `${first} ${last}` (`input.name`). Do not add a sixth form: pass props to this one.

| Page | Route | Notes |
|---|---|---|
| `your-account/AccountRegister.tsx` | `/account?mode=create` | The page owns the h1 and the Sign in / Create account switch |
| `OrganiserRegister.tsx` | `/organiser/register` | Sends `name, email, password` only (no consent field) |
| `account/ParticipantRegisterPage.tsx` | `/my/register` | |
| `join/RegisterPage.tsx` | `/j/:token/register` | Extra field: "I need an accessible seat" |
| `owner/OwnerSignUpPage.tsx` | no route in `App.tsx` today | Owner theme, not on the photo |

The password stays in memory until the account exists (a new code re-registers with it, and
`verifyAccount` needs it). Fit on one screen is measured on the pristine form: errors, an open
"What we store" and a browser's own bars make a page taller.
