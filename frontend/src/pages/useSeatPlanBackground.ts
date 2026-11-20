import { useEffect, useState, type CSSProperties } from "react";

const BACKGROUND_IMAGE = "/images/seatplan-flow-background.png";

/** Use the supplied artwork when it exists and keep the CSS gradient as fallback. */
export function useSeatPlanBackground(): string | null {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const probe = new Image();
    probe.onload = () => {
      if (active) setImage(`url("${BACKGROUND_IMAGE}")`);
    };
    probe.onerror = () => {
      if (active) setImage(null);
    };
    probe.src = BACKGROUND_IMAGE;

    return () => {
      active = false;
      probe.onload = null;
      probe.onerror = null;
    };
  }, []);

  return image;
}

export function seatPlanBackgroundStyle(image: string | null): CSSProperties {
  return image ? ({ "--welcome-photo": image } as CSSProperties) : {};
}
