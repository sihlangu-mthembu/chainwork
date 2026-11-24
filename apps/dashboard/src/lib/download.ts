/**
 * SPDX-License-Identifier: MIT
 * Browser download helpers (no server round trip, nothing leaves the tab).
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** JSON.stringify with bigint support, so receipts and audits serialise without surprises. */
export function toJsonText(value: unknown, space = 2): string {
  return JSON.stringify(
    value,
    (_key: string, val: unknown) => (typeof val === "bigint" ? val.toString() : val),
    space,
  );
}

export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(new Blob([toJsonText(value)], { type: "application/json" }), filename);
}
