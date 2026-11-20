import { Link } from "react-router-dom";
import { EmptyState, PageShell } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";

export default function NotFound() {
  return (
    <PageShell title="Page not found" headerActions={<PublicHeaderActions />}>
      <EmptyState
        title="This seat does not exist"
        action={
          <Link className="btn btn-primary" to="/">
            Back to the start
          </Link>
        }
      >
        <p>The link may be old or mistyped. Personal links from an email still work if you open them exactly as sent.</p>
      </EmptyState>
    </PageShell>
  );
}
