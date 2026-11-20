import { api } from "./client";
import type { ReviewSummary } from "./discovery";

export const REVIEW_TABLES = [
  { value: "general", label: "Dining room" }, { value: "window", label: "Window" },
  { value: "terrace", label: "Terrace" }, { value: "quiet", label: "Quiet area" },
  { value: "bar", label: "Bar" }, { value: "group", label: "Group table" },
  { value: "accessible", label: "Accessible table" },
];
export interface ReviewDraft { score: number; comment: string; table_type: string | null }
export interface Review extends ReviewDraft { id: string; author: string; verified: boolean; created_at: string }
interface ReviewsPage { items: Review[]; total: number; summary: ReviewSummary }
interface MyReview { review: Review | null }

function path(slug: string) {
  return `/restaurants/${encodeURIComponent(slug)}/reviews`;
}

export function getReviews(slug: string, query: string) {
  return api.get<ReviewsPage>(`${path(slug)}?${query}`, "none");
}
export function getMyReview(slug: string) {
  return api.get<MyReview>(`${path(slug)}/mine`, "guest");
}
export function saveReview(slug: string, draft: ReviewDraft) {
  return api.put<MyReview>(`${path(slug)}/mine`, draft, "guest");
}
export function deleteReview(slug: string) {
  return api.delete<{ deleted: boolean }>(`${path(slug)}/mine`, "guest");
}
