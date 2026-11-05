/** A small line diff for showing what an Edit changed: common lines as context, removed and added lines marked. */
export interface DiffLine {
  t: " " | "+" | "-";
  s: string;
}

const MAX = 400;

export function lineDiff(before: string, after: string): { lines: DiffLine[]; add: number; del: number } {
  // A final newline ends the last line; it does not start an empty one.
  const split = (t: string) => {
    if (t === "") return [];
    const l = t.split("\n");
    if (l[l.length - 1] === "") l.pop();
    return l;
  };
  const a = split(before);
  const b = split(after);
  if (a.length > MAX || b.length > MAX) {
    // Too big for the exact diff: everything removed, then everything added.
    return { lines: [...a.map((s) => ({ t: "-" as const, s })), ...b.map((s) => ({ t: "+" as const, s }))], add: b.length, del: a.length };
  }
  // Longest common subsequence of lines.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines: DiffLine[] = [];
  let add = 0;
  let del = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ t: "-", s: a[i++] });
      del++;
    } else {
      lines.push({ t: "+", s: b[j++] });
      add++;
    }
  }
  while (i < n) {
    lines.push({ t: "-", s: a[i++] });
    del++;
  }
  while (j < m) {
    lines.push({ t: "+", s: b[j++] });
    add++;
  }
  return { lines, add, del };
}

/** Parse a unified diff (as git prints it) into displayable lines, dropping the file header. */
export function parsePatch(patch: string): DiffLine[] & { hunks?: never } {
  const out: DiffLine[] = [];
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      out.push({ t: " ", s: line });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) out.push({ t: "+", s: line.slice(1) });
    else if (line.startsWith("-")) out.push({ t: "-", s: line.slice(1) });
    else if (line.startsWith("\\")) continue;
    else out.push({ t: " ", s: line.slice(1) });
  }
  return out;
}
