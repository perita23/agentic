/**
 * Copy text, whatever the environment: the async Clipboard API, then the macOS
 * app's native clipboard (if the window denies the permission), then the
 * legacy selection-based copy. Resolves false only if every method failed.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const desktop = (window as unknown as { agenticDesktop?: { copyText?: (t: string) => Promise<boolean> } }).agenticDesktop;
    if (desktop?.copyText && (await desktop.copyText(text))) return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
