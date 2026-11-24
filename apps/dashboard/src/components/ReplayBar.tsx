/**
 * SPDX-License-Identifier: MIT
 * Replay controls: play the tree's on-chain history step by step, scrub to any step, or follow live.
 */
import type { TimelineEntry } from "../lib/events";

interface Props {
  entries: TimelineEntry[];
  /** Index of the step on screen; entries.length - 1 when live. */
  step: number;
  live: boolean;
  playing: boolean;
  time: string | null;
  onStep(step: number): void;
  onPlay(): void;
  onLive(): void;
}

export function ReplayBar({ entries, step, live, playing, time, onStep, onPlay, onLive }: Props) {
  const last = entries.length - 1;
  const current = entries[step];
  return (
    <div className="replay">
      <div className="replay-buttons">
        <button type="button" className="replay-btn" onClick={() => onStep(Math.max(0, step - 1))} disabled={step <= 0} aria-label="Previous step">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
        <button type="button" className="replay-btn is-play" onClick={onPlay} aria-label={playing ? "Pause" : "Play the history"}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <button type="button" className="replay-btn" onClick={() => onStep(Math.min(last, step + 1))} disabled={step >= last} aria-label="Next step">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="m5 2 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
      </div>
      <div className="replay-track">
        <div className="replay-ticks" role="group" aria-label="Steps">
          {entries.map((e, i) => (
            <button
              key={e.key}
              type="button"
              className={`replay-tick tone-${e.tone}${i <= step ? " is-past" : ""}${i === step ? " is-now" : ""}`}
              onClick={() => onStep(i)}
              title={e.text}
              aria-label={`Step ${i + 1}: ${e.text}`}
            />
          ))}
        </div>
        <div className="replay-caption">
          <span className="replay-count">
            {entries.length === 0 ? "No steps yet" : `Step ${step + 1} of ${entries.length}`}
            {time ? `, ${time}` : ""}
          </span>
          <span className="replay-text">{current?.text ?? ""}</span>
        </div>
      </div>
      <button type="button" className={live ? "live-btn is-live" : "live-btn"} onClick={onLive} aria-pressed={live}>
        <span className="live-dot" aria-hidden="true" />
        {live ? "Live" : "Back to live"}
      </button>
      <p className="keys">
        <kbd>Space</kbd> play <kbd>←</kbd> <kbd>→</kbd> step <kbd>L</kbd> live <kbd>[</kbd> <kbd>]</kbd> other trees
      </p>
    </div>
  );
}
