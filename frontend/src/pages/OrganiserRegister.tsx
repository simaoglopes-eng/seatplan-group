import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { request, setSessionToken } from "../api/client";
import { AuthLayout, PageShell } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { AuthPhoto } from "./Login";
import { SignUpForm } from "./signup/SignUpForm";
import "./login.css";

/**
 * Where to go once the account is verified: ?next= when it is a path on this site
 * (starts with "/", not "//" and no backslash, which browsers read as "//"), else the
 * organiser space. So /organiser?new=1 survives sign-up, and a link cannot send the
 * new organiser to another site.
 */
export function registerNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return "/organiser";
}

type CodeResponse = { signup_id: string; sent_to: string };
type SessionResponse = { token: string };

/** /organiser/register: the shared sign-up form (pages/signup/) on the organiser endpoints. */
export default function OrganiserRegister() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  return (
    <AuthPhoto compact>
      <PageShell title="Create an organiser account" variant="overlay" headerActions={<PublicHeaderActions />}>
        <AuthLayout eyebrow="FOR ORGANISERS" headline="A place for every detail." description="Set up your event, shape the room and make it easy for everyone to find their seat." compact>
          <SignUpForm
            idPrefix="org"
            copy={{
              title: "Create your organiser account",
              lede: "Create an account to plan and manage your events.",
              codeLede: (sentTo) => `If this address can be registered, a verification code will be sent to ${sentTo}. Email delivery must be configured for the code to arrive.`,
            }}
            // The password stays in memory until the account exists, so a new code can be sent.
            register={async ({ name, email, password }) => {
              const sent = await request<CodeResponse>("POST", "/auth/register", { name, email, password }, "none");
              return { signupId: sent.signup_id, sentTo: sent.sent_to };
            }}
            verify={({ email, code, signupId }) => request<SessionResponse>("POST", "/auth/verify", { email, code, signup_id: signupId }, "none")}
            onDone={(result) => {
              setSessionToken(result.token);
              navigate(registerNext(next));
            }}
            links={<Link to={next ? `/login?next=${encodeURIComponent(registerNext(next))}` : "/login"}>Already have an account? Sign in</Link>}
          />
        </AuthLayout>
      </PageShell>
    </AuthPhoto>
  );
}
