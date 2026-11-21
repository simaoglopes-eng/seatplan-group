// Create a SeatPlan account (plan 2026-11-18, decision 5): one sign-up for bookings and work.
// The form and the code step are the shared SignUpForm (pages/signup/); this page only says what to call:
// 1. POST /account/register with exactly four fields (name, email, password, consent): the same 202
//    answer whether or not the address already has an account; in the demo, example.com codes are shown;
// 2. the 6-digit code -> POST /guest/verify, which signs in. api/account.ts keeps the work session
//    that comes back, or asks /account/login for it with the same password.
import { Link } from "react-router-dom";
import { accountRegister, verifyAccount } from "../../api/account";
import type { AccountSessions } from "../../api/account";
import { SignUpForm } from "../signup/SignUpForm";

export function AccountRegister({ onCreated }: { onCreated: (sessions: AccountSessions) => void }) {
  return (
    <SignUpForm
      idPrefix="account"
      // The page already has the h1 and the Sign in | Create account switch above the form.
      headingLevel={2}
      copy={{ title: null, lede: null }}
      register={async ({ name, email, password }) => {
        const sent = await accountRegister({ name, email, password, consent: true });
        return { signupId: sent.signup_id ?? "", sentTo: sent.sent_to, demoCode: sent.demo_code };
      }}
      verify={({ email, code, signupId, password }) => verifyAccount(email, code, signupId, password)}
      onDone={onCreated}
      links={<Link to="/account">Already have an account? Sign in</Link>}
      linksOnForm={false}
    />
  );
}
