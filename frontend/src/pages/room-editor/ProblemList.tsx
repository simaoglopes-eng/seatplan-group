import { Button } from "../../design/components";
import type { RoomProblem } from "./validation";

/** Only what stops the plan working (walls that cross, a table outside the walls). Warnings and tips are not shown. */
export function ProblemList({ problems, onSelect }: { problems: RoomProblem[]; onSelect: (problem: RoomProblem) => void }) {
  const errors = problems.filter(p => p.level === "error");
  if (!errors.length) return null;
  return <ul className="room-problem-wrap room-problems">{errors.map((problem, index) => <li key={`${problem.room_key}:${problem.code}:${index}`}><Button variant="ghost" className="room-problem-error" onClick={() => onSelect(problem)}><span aria-hidden="true">⚠</span> {problem.message}</Button></li>)}</ul>;
}
