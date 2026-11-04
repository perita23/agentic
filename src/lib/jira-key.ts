/** First Jira issue key (e.g. INOX-2021) found in the given texts, in order. */
export const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/;

export function detectJiraKey(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t ? JIRA_KEY_RE.exec(t) : null;
    if (m) return m[0];
  }
  return null;
}
