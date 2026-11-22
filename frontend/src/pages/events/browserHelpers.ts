// The few browser features the organiser screen needs (clipboard, file
// download), each wrapped so a missing feature never crashes the page.

/** The server may send a path ("/e/abc") or a full URL; people need the full one. */
export function fullLink(link: string): string {
  return link.startsWith("/") ? `${window.location.origin}${link}` : link;
}

/** Copy through the Clipboard API or the browser's selection-based fallback. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Some embedded browsers block the Clipboard API but allow copying a selection.
  }

  const focused = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}

/** Saves text as a file by clicking a temporary link. */
export function downloadText(filename: string, text: string, type: string): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * On a phone the organiser's map sits far above the guest list. When it is
 * not fully on screen, scroll it into view and put the keyboard focus on the
 * map, so "Place, then choose a seat" works without hunting for the map.
 * Returns true when it had to move.
 */
export function bringMapIntoView(box: HTMLElement | null): boolean {
  if (!box) return false;
  const rect = box.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return false;
  // Optional call: older browsers have no scrollIntoView options.
  box.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  box.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });
  return true;
}
