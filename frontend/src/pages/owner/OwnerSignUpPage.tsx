import { Link, useNavigate } from "react-router-dom";
import { registerOwner, verifyOwner } from "../../api/owner";
import { PageShell } from "../../design/components";
import { SignUpForm } from "../signup/SignUpForm";
import "./owner.css";

/** /owner/sign-up: the shared sign-up form (pages/signup/) in the owner theme, on the owner endpoints. */
export default function OwnerSignUpPage() {
  const navigate = useNavigate();
  return (
    <PageShell title="Create an owner account">
      <div className="owner-auth">
        <SignUpForm
          idPrefix="owner"
          copy={{
            title: "Create an owner account",
            lede: "Set up your restaurant and let guests choose their table.",
            codeLede: (sentTo) => `Enter the six-digit code sent to ${sentTo}. It expires in 15 minutes.`,
          }}
          // The password stays in memory until the account exists, so a new code can be sent.
          register={async ({ name, email, password }) => {
            const sent = await registerOwner({ name, email, password, consent: true });
            return { signupId: sent.signup_id, demoCode: sent.code_shown };
          }}
          verify={({ email, code, signupId }) => verifyOwner(email, code, signupId)}
          onDone={() => navigate("/owner", { replace: true })}
          links={<Link to="/owner/sign-in">Already have an account? Sign in</Link>}
        />
      </div>
    </PageShell>
  );
}
