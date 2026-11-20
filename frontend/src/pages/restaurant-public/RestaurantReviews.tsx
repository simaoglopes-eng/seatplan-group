import { useState } from "react";
import { Link } from "react-router-dom";
import { getGuestToken } from "../../api/client";
import type { ReviewSummary } from "../../api/discovery";
import { deleteReview, getMyReview, getReviews, REVIEW_TABLES, saveReview } from "../../api/reviews";
import type { Review } from "../../api/reviews";
import { Button, Dialog, ErrorState, Select, Skeleton } from "../../design/components";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { ReviewRating } from "./ReviewRating";

const PAGE = 20;
const SCORES = Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: `${n}/10` }));
const ORDERS = [
  { value: "recent", label: "Most recent" },
  { value: "highest", label: "Highest rating" },
  { value: "lowest", label: "Lowest rating" },
];

export function RestaurantReviews({ slug, summary }: { slug: string; summary?: ReviewSummary }) {
  const [filters, setFilters] = useState({ sort: "recent", score: "", table_type: "", verified: false });
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState(false);
  const signedIn = Boolean(getGuestToken());
  const query = new URLSearchParams({ sort: filters.sort, limit: String(PAGE), offset: String(offset) });
  if (filters.score) query.set("score", filters.score);
  if (filters.table_type) query.set("table_type", filters.table_type);
  if (filters.verified) query.set("verified", "true");
  const page = useLoad(() => getReviews(slug, query.toString()), `${slug}:${query}`);
  const { state, reload } = page;
  const own = useLoad(() => signedIn ? getMyReview(slug) : Promise.resolve({ review: null }), `${slug}:${signedIn}`);
  const answer = state.status === "ready" ? state.data : undefined;
  const displayed = answer?.summary ?? summary ?? { average: null, count: 0 };
  const changeFilters = (next: Partial<typeof filters>) => {
    setOffset(0);
    setFilters(current => ({ ...current, ...next }));
  };
  const afterWrite = (review: Review | null) => {
    own.setData({ review });
    setEditing(false);
    if (offset) setOffset(0);
    else reload();
  };

  return (
    <div className="restaurant-reviews">
      <div className="reviews-head">
        <div><h2>Reviews</h2><ReviewRating summary={displayed} /></div>
        {signedIn && own.state.status === "ready" && (
          <Button onClick={() => setEditing(true)}>{own.state.data.review ? "Edit your review" : "Write a review"}</Button>
        )}
        {!signedIn && <Link className="btn btn-secondary" to="/restaurants/account" state={{ reviewSlug: slug }}>Log in to review</Link>}
      </div>
      {signedIn && own.state.status === "error" &&
        <Button variant="ghost" onClick={() => own.reload()}>Retry loading your review</Button>}
      <div className="reviews-filters" role="group" aria-label="Filter reviews">
        <Select className="select-themed" label="Sort by" options={ORDERS} value={filters.sort}
          onChange={event => changeFilters({ sort: event.target.value })} />
        <Select className="select-themed" label="Rating" options={[{ value: "", label: "Any rating" }, ...SCORES]} value={filters.score}
          onChange={event => changeFilters({ score: event.target.value })} />
        <Select className="select-themed" label="Table type" options={[{ value: "", label: "Any table" }, ...REVIEW_TABLES]} value={filters.table_type}
          onChange={event => changeFilters({ table_type: event.target.value })} />
        <label className="reviews-verified"><input type="checkbox" checked={filters.verified}
          onChange={event => changeFilters({ verified: event.target.checked })} /> Verified visits only</label>
      </div>
      {state.status === "loading" && <Skeleton lines={3} label="Loading reviews" />}
      {state.status === "error" && <ErrorState message={errorMessage(state.error)} onRetry={() => reload()} />}
      {answer && <>
        {answer.total === 0 && <p>{displayed.count ? "No reviews match these filters." : "Be the first to leave a review."}</p>}
        {answer.items.length > 0 && <ul className="reviews-list">{answer.items.map(review => (
          <li key={review.id}>
            <div className="reviews-item-head">
              <strong>{review.author}</strong>
              <span>{review.score}/10</span>
              {review.verified && <span className="reviews-verified-badge">Verified visit</span>}
            </div>
            <div className="reviews-item-meta">
              <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString("en-GB")}</time>
              {review.table_type && <span>{REVIEW_TABLES.find(table => table.value === review.table_type)?.label}</span>}
            </div>
            {review.comment && <p>{review.comment}</p>}
          </li>
        ))}</ul>}
        {(offset > 0 || offset + PAGE < answer.total) && <div className="reviews-pagination">
          <Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - PAGE)}>Previous reviews</Button>
          <Button variant="secondary" disabled={offset + PAGE >= answer.total} onClick={() => setOffset(offset + PAGE)}>Next reviews</Button>
        </div>}
      </>}
      {signedIn && editing && own.state.status === "ready" && <ReviewEditor slug={slug} review={own.state.data.review}
        onClose={() => setEditing(false)} onSave={afterWrite} />}
    </div>
  );
}

function ReviewEditor({ slug, review, onClose, onSave }: {
  slug: string; review: Review | null; onClose: () => void; onSave: (review: Review | null) => void;
}) {
  const [score, setScore] = useState(review ? String(review.score) : "");
  const [comment, setComment] = useState(review?.comment ?? "");
  const [table, setTable] = useState(review?.table_type ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (remove = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await deleteReview(slug);
        onSave(null);
      } else {
        const result = await saveReview(slug, { score: Number(score), comment, table_type: table || null });
        onSave(result.review);
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };
  return (
    <Dialog open title={review ? "Edit your review" : "Write a review"} onClose={onClose}>
      <form className="review-editor" onSubmit={event => { event.preventDefault(); if (score !== "") void save(); }}>
        <Select className="select-themed" label="Your rating" value={score} required onChange={event => setScore(event.target.value)}
          options={[{ value: "", label: "Choose a rating from 0 to 10" }, ...SCORES]} />
        <Select className="select-themed" label="Your table type (optional)" value={table} onChange={event => setTable(event.target.value)}
          options={[{ value: "", label: "Choose a table type" }, ...REVIEW_TABLES]} />
        <label className="field">Comment (optional)
          <textarea className="field-input" rows={4} maxLength={1500} value={comment}
            onChange={event => setComment(event.target.value)} />
        </label>
        <p className="review-count">Your first name appears with your review.</p>
        {error && <p role="alert">{error}</p>}
        <div className="reviews-pagination">
          {review && <Button variant="danger" disabled={busy} onClick={() => void save(true)}>Delete review</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy} disabled={score === ""}>Publish review</Button>
        </div>
      </form>
    </Dialog>
  );
}
