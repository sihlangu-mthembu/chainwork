/**
 * SPDX-License-Identifier: MIT
 * Small pieces used across the story view: agent glyphs, copy buttons and toasts.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Six desk-friendly hues; an address always gets the same one. */
const HUES = ["#3d6fd8", "#1f9e8f", "#b4572e", "#7c5cc4", "#b38a12", "#c2457a"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Two letters from a readable name ("Backup metrics agent" → "BM"), or from the address. */
function initials(name: string): string {
  if (name.startsWith("0x")) return name.slice(2, 4).toUpperCase();
  const words = name.replace(/\bagent\b/i, "").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

/** Fixed colours for the demo's cast, so no two roles ever share one. */
const ROLE_HUES: Record<string, string> = {
  "Client smart account": "#7c5cc4",
  Client: "#7c5cc4",
  "Coordinator agent": "#1f9e8f",
  "Data agent": "#c0622b",
  "Unreliable metrics agent": "#c2457a",
  "Backup metrics agent": "#3d6fd8",
  Watcher: "#8f7a2e",
  Evaluator: "#61708a",
  Facilitator: "#4e5d75",
};

/** The colour an agent is drawn in, everywhere (glyphs, ledger): by role when known, else by address. */
export function hueOf(address: string, name?: string): string {
  return (name && ROLE_HUES[name]) || HUES[hash(address.toLowerCase()) % HUES.length] || "#3d6fd8";
}

/** A round mark for an agent: same address, same colour and letters, everywhere on the page. */
export function Glyph({ address, name, size = 22 }: { address: string; name: string; size?: number }) {
  const color = hueOf(address, name);
  return (
    <span className="glyph" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }} title={`${name} ${address}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Copy a value; the button says "Copied" for a moment so the person knows it worked. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1400);
  }, [value]);
  return (
    <button type="button" className={done ? "copy is-done" : "copy"} onClick={() => void copy()} title={`${label} ${value}`} aria-label={`${label} ${value}`}>
      {done ? (
        "Copied"
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 2.2V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
}

export interface Toast {
  id: string;
  text: ReactNode;
  tone: string;
  action?: { label: string; run(): void };
}

/** Bottom-corner notices for things that happened while you were looking elsewhere. */
export function Toasts({ items, onClose }: { items: Toast[]; onClose(id: string): void }) {
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((t) => window.setTimeout(() => onClose(t.id), 6000));
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [items, onClose]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          <span className="toast-text">{t.text}</span>
          {t.action ? (
            <button type="button" className="toast-action" onClick={t.action.run}>
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-close" onClick={() => onClose(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
