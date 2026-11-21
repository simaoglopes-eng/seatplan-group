// Route /j/:token/register: a visitor creates a guest account to choose a seat.
//
// Two steps on one page, both drawn by the shared SignUpForm (pages/signup/):
// 1. the form (first and last name, email, password, consent, and "I need an accessible seat",
//    this page's one extra field) -> POST /j/{token}/register, which emails a 6-digit code (the answer
//    is the same whether or not the address already has an account, so nobody can find out who has one);
// 2. the code -> POST /guest/verify, which makes the account, signs in and
//    tries to join the event. joinOutcome() decides where to go next.
// Nothing is stored for the event until the code is typed (docs/guest-accounts.md D1).
import { Link, useNavigate, useParams } from "react-router-dom";
import { register, verifyCode } from "../../api/guest";
import { AuthLayout, Checkbox, PageShell, useToast } from "../../design/components";
import { joinOutcome } from "./joinOutcome";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { AuthPhoto } from "../Login";
import { SignUpForm } from "../signup/SignUpForm";
import "../account/account.css";
import "./join.css";

export default function RegisterPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <AuthPhoto compact>
      <PageShell title="Create your account" variant="overlay" headerActions={<PublicHeaderActions />}>
        <AuthLayout eyebrow="FOR PARTICIPANTS" headline="Your invitation, all in one place." description="Confirm your email, choose a seat and keep your event details close at hand." compact>
          <SignUpForm
            idPrefix="reg"
            copy={{ title: "Create your account" }}
            nameHint="The organiser sees your name. Other guests see it as the organiser's privacy setting allows."
            initialExtra={{ needsAccessible: false }}
            register={async ({ name, email, password, extra }) => {
              const sent = await register(token, { name, email, password, needs_accessible: extra.needsAccessible, consent: true });
              return { signupId: sent.signup_id ?? "", sentTo: sent.sent_to, demoCode: sent.demo_code };
            }}
            verify={({ email, code, signupId }) => verifyCode(email, code, signupId)}
            onDone={(result) => {
              const outcome = joinOutcome(result.join, true);
              if (outcome.toast) toast.show(outcome.toast, "success");
              navigate(outcome.to, outcome.notice ? { state: { notice: outcome.notice } } : undefined);
            }}
            renderExtra={(extra, setExtra) => (
              <Checkbox label="I need an accessible seat" checked={extra.needsAccessible} onChange={(e) => setExtra({ needsAccessible: e.target.checked })} />
            )}
            links={
              <>
                <Link to={`/j/${encodeURIComponent(token)}/sign-in`}>Already have an account? Sign in</Link>
                <Link to={`/j/${encodeURIComponent(token)}`}>Back to the event</Link>
              </>
            }
          />
        </AuthLayout>
      </PageShell>
    </AuthPhoto>
  );
}
