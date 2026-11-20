import type { ReviewSummary } from "../../api/discovery";
import chair from "../../design/review-chair.webp";
import twoChairs from "../../design/review-chairs-two.webp";
import threeChairs from "../../design/review-chairs-three.webp";
import fourChairs from "../../design/review-chairs-four.webp";
import "./reviews.css";

const number = new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
type Bounds = readonly [x: number, y: number, width: number, height: number];
// All source illustrations have the same 440 × 246 canvas.
const rear: Bounds = [123, 65, 63, 97];
const center: Bounds = [180, 70, 81, 122];
const right: Bounds = [257, 110, 61, 94];
const front: Bounds = [140, 138, 61, 80];
const groups = [
  { min: 8.5, source: fourChairs, bounds: [123, 65, 195, 153], chairs: [rear, center, right, front] },
  { min: 6.5, source: threeChairs, bounds: [123, 65, 195, 139], chairs: [rear, center, right] },
  { min: 4, source: twoChairs, bounds: [180, 70, 138, 134], chairs: [center, right] },
];
const percent = (part: number, whole: number) => `${part / whole * 100}%`;

function RatingChairs({ score }: { score: number }) {
  const group = groups.find(item => score >= item.min);
  if (!group) return <span className="review-chair" aria-hidden="true"><img src={chair} alt="" /></span>;

  const [x, y, width, height] = group.bounds;
  return (
    <span className="review-chairs" style={{ aspectRatio: `${width} / ${height}` }} aria-hidden="true">
      {group.chairs.map(([left, top, w, h]) => (
        <span key={left} className={`review-chair review-chair-crop${left === front[0] ? " review-chair-front" : ""}`}
          style={{ left: percent(left - x, width), top: percent(top - y, height), width: percent(w, width), height: percent(h, height) }}>
          <img src={group.source} alt="" style={{
            left: percent(-left, w), top: percent(-top, h), width: percent(440, w), height: percent(246, h),
          }} />
        </span>
      ))}
    </span>
  );
}

export function ReviewRating({ summary }: { summary: ReviewSummary }) {
  if (summary.average === null) return <span className="review-count">No reviews yet</span>;
  return (
    <span className="review-rating">
      <span className="review-score">
        <span className="visually-hidden">Rated </span>{number.format(summary.average)}
        <span className="visually-hidden"> out of 10</span>
        <RatingChairs score={summary.average} />
      </span>
      <span className="review-count">From {summary.count} {summary.count === 1 ? "review" : "reviews"}</span>
    </span>
  );
}
