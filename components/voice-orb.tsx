"use client";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "thinking";

const LABELS: Record<OrbState, string> = {
  idle: "Wake Recall",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Working",
};

// The center of the app. Audio-reactive via the --lvl custom property
// (0..1) set by the voice panel's animation loop on a wrapping element.
export function VoiceOrb({ state, onClick }: { state: OrbState; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={LABELS[state]} className={`orb orb-${state}`}>
      <span className="orb-halo" aria-hidden />
      <span className="orb-ring" aria-hidden />
      <span className="orb-core" aria-hidden />
    </button>
  );
}
