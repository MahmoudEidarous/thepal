// This module deliberately has no model or framework imports. Secret removal
// must stay local and deterministic, and the replay harness imports it directly.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk_[A-Za-z0-9]{16,}/g,
  /sm_[A-Za-z0-9]{16,}/g,
  /gsk_[A-Za-z0-9]{16,}/g,
  /csk-[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[A-Z0-9]{12,}/g,
  /xoxb-[A-Za-z0-9-]{20,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/gi,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let output = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(output)) continue;
    redacted = true;
    pattern.lastIndex = 0;
    output = output.replace(pattern, "[redacted]");
  }
  return { text: output, redacted };
}
