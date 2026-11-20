/** Turn a SeatPlan invitation URL or short token into a local app route. */
export function invitationPath(value: string, currentOrigin: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.origin !== currentOrigin) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else if (/^\/?[je]\//i.test(trimmed)) {
    path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  } else if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    // Shared invite codes are the token segment of the existing /j/:token route.
    return `/j/${trimmed}`;
  } else {
    return null;
  }

  const match = path.replace(/\/+$/, "").match(/^\/(j|e)\/([A-Za-z0-9_-]+)$/i);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : null;
}
