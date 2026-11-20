// A live count that counts up once when it enters the screen (see useCountUp).
// It holds its final value before and after, so the text always reads right.
import { formatCount } from "../homeSample";
import { useCountUp } from "./useMotion";

export function CountUp({ value }: { value: number }) {
  const { ref, shown } = useCountUp<HTMLSpanElement>(value);
  return (
    <span ref={ref} className="ld-count">
      {formatCount(shown)}
    </span>
  );
}
