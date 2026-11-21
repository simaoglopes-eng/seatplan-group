import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { verifyCode } from "../../api/guest";
import type { CodeSent } from "../../api/guest";
import { AuthLayout, PageShell } from "../../design/components";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { AuthPhoto } from "../Login";
import { SignUpForm } from "../signup/SignUpForm";
import "../login.css";
import "./account.css";

/** /my/register: the shared sign-up form (pages/signup/) on the participant endpoints. */
export default function ParticipantRegisterPage() {
  const navigate = useNavigate();
  return (
    <AuthPhoto compact>
      <PageShell title="Create a participant account" variant="overlay" headerActions={<PublicHeaderActions />}>
        <AuthLayout eyebrow="FOR PARTICIPANTS" headline="Your invitation, all in one place." description="Find your event, choose a seat and keep the details close at hand." compact>
          <SignUpForm
            idPrefix="participant"
            copy={{
              title: "Create your participant account",
              lede: "Create an account now, then open an event invitation to choose your seat.",
              codeLede: (sentTo) => `If this address can be registered, a verification code will be sent to ${sentTo}. Email delivery must be configured for the code to arrive.`,
            }}
            // The password stays in memory until the account exists, so a new code can be sent.
            register={async ({ name, email, password }) => {
              const sent = await api.post<CodeSent>("/guest/register", { name, email, password, needs_accessible: false, consent: true }, "none");
              return { signupId: sent.signup_id ?? "", sentTo: sent.sent_to, demoCode: sent.demo_code };
            }}
            verify={({ email, code, signupId }) => verifyCode(email, code, signupId)}
            onDone={() => navigate("/my")}
            links={<Link to="/my/sign-in">Already have an account? Sign in</Link>}
          />
        </AuthLayout>
      </PageShell>
    </AuthPhoto>
  );
}
