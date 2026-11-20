// "Can't find your venue?": the way out of the directory and of /events when the list does
// not have the place someone has in mind. Opens the organiser space on a new event.
// Styles in directory.css (.dir-own); EventsPage imports that file too.
import { Link } from "react-router-dom";

export const CREATE_OWN_HREF = "/organiser?new=1";

export function CreateOwnEvent({ id = "dir-own-title" }: { id?: string }) {
  return (
    <aside className="dir-own" aria-labelledby={id}>
      <p id={id} className="dir-own-text">
        <strong>Can't find your venue?</strong> Create your own event at any place, even one that is not listed.
      </p>
      <Link className="btn btn-primary dir-own-btn" to={CREATE_OWN_HREF}>
        Create your own event
      </Link>
    </aside>
  );
}
