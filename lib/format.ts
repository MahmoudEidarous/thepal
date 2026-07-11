export function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The user's first name. Only an explicit statement counts — "my name
// is X" / "the user's name is X" — never a guess from whichever name the
// engine mentions most (that once picked a friend). Feed it profile
// lines AND raw capture texts; the capture is the user's own words.
export function profileName(lines: string[]): string | null {
  const m = lines.join(" ").match(/(?:user'?s?|my) name is (\w+)/i);
  return m ? m[1] : null;
}
