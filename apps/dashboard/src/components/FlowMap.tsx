/**
 * SPDX-License-Identifier: MIT
 * The money map: who paid whom inside one job tree. Payer → root ticket → subcontract tickets,
 * joined by gold thread when money has moved, dashed red when a hire was refused. When money moves
 * (live or in replay) a few coins run along the line that carried it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { JobNode } from "@chainwork/types";
import { formatMoney } from "../lib/format";
import type { Flow } from "../lib/replay";
import { Glyph } from "./bits";
import { Ticket } from "./Ticket";

interface Edge {
  id: string;
  d: string;
  label: string;
  lx: number;
  ly: number;
  ink: "gold" | "red" | "wait";
}

export interface Pulse {
  key: string;
  flow: Flow;
}

interface Props {
  tree: JobNode;
  now: number;
  nameOf(address: string): string;
  selected: bigint | null;
  onSelect(id: bigint): void;
  /** Job id (string) highlighted from the timeline or by hovering a ticket. */
  hover: string | null;
  onHover(id: string | null): void;
  pulses: Pulse[];
}

const inkOf = (n: JobNode): Edge["ink"] =>
  n.ui === "Settled" ? "gold" : n.ui === "Rejected" || n.ui === "Refunded" ? "red" : "wait";

export function FlowMap({ tree, now, nameOf, selected, onSelect, hover, onHover, pulses }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const payer = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLButtonElement>(null);
  const kids = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const shape = `${tree.job.id}:${tree.ui}:` + tree.children.map((c) => `${c.job.id}:${c.ui}`).join(",");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const right = (n: Element) => {
        const r = n.getBoundingClientRect();
        return { x: r.right - box.left, y: r.top - box.top + r.height / 2 };
      };
      const left = (n: Element) => {
        const r = n.getBoundingClientRect();
        return { x: r.left - box.left, y: r.top - box.top + r.height / 2 };
      };
      const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const mx = (a.x + b.x) / 2;
        return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
      };
      const out: Edge[] = [];
      const stacked =
        !root.current || !payer.current || root.current.getBoundingClientRect().left - payer.current.getBoundingClientRect().right < 24;
      if (!stacked && payer.current && root.current) {
        const a = right(payer.current);
        const b = left(root.current);
        out.push({ id: "payer", d: curve(a, b), label: formatMoney(tree.job.budget), lx: (a.x + b.x) / 2, ly: Math.min(a.y, b.y) - 11, ink: tree.ui === "Quoted" ? "wait" : "gold" });
      }
      if (!stacked && root.current) {
        const a = right(root.current);
        for (const child of tree.children) {
          const n = kids.current.get(child.job.id.toString());
          if (!n) continue;
          const b = left(n);
          out.push({ id: child.job.id.toString(), d: curve(a, b), label: formatMoney(child.job.budget), lx: a.x + (b.x - a.x) * 0.74, ly: b.y - 10, ink: inkOf(child) });
        }
      }
      setEdges(out);
      setSize({ w: box.width, h: box.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shape, tree]);

  const rootId = tree.job.id.toString();
  const related = (edgeId: string): boolean => hover === null || hover === edgeId || hover === rootId;

  return (
    <div className="flow" ref={wrap}>
      <svg className="flow-lines" width={size.w} height={size.h} aria-hidden="true">
        {edges.map((e) => (
          <g key={e.id} className={`edge edge-${e.ink}${related(e.id) ? "" : " is-dim"}`}>
            <path d={e.d} className="edge-glow" />
            <path d={e.d} className={e.ink === "red" ? "edge-path is-dashed" : "edge-path"} />
            <text x={e.lx} y={e.ly} textAnchor="middle" className="edge-label">
              {e.label}
            </text>
          </g>
        ))}
      </svg>

      {pulses.map((p) => {
        const edge = edges.find((e) => e.id === p.flow.edge);
        if (!edge) return null;
        return [0, 1, 2].map((i) => (
          <span
            key={`${p.key}:${i}`}
            className={p.flow.direction === "back" ? "coin-run is-back" : "coin-run"}
            style={{
              offsetPath: `path("${edge.d}")`,
              animationDelay: `${i * 140}ms`,
              animationDirection: p.flow.direction === "back" ? "reverse" : "normal",
            }}
            aria-hidden="true"
          />
        ));
      })}

      <div className="flow-col flow-col-payer">
        <div className="payer" ref={payer}>
          <Glyph address={tree.job.client} name={nameOf(tree.job.client)} size={30} />
          <span className="payer-who">{nameOf(tree.job.client)}</span>
          <span className="payer-what">signed one payment into escrow and paid no gas</span>
        </div>
      </div>

      <div className="flow-col flow-col-root">
        <Ticket
          ref={root}
          node={tree}
          holder={nameOf(tree.job.provider)}
          now={now}
          root
          selected={selected === tree.job.id}
          lit={hover === rootId}
          dim={hover !== null && hover !== rootId && !tree.children.some((c) => c.job.id.toString() === hover)}
          onSelect={() => onSelect(tree.job.id)}
          onHover={(on) => onHover(on ? rootId : null)}
        />
      </div>

      <div className="flow-col flow-col-kids">
        {tree.children.length === 0 ? (
          <p className="flow-empty">No subcontracts yet. When the provider hires help, each hire appears here, paid out of this job's escrow.</p>
        ) : (
          tree.children.map((child) => {
            const id = child.job.id.toString();
            return (
              <Ticket
                key={id}
                ref={(n) => {
                  if (n) kids.current.set(id, n);
                  else kids.current.delete(id);
                }}
                node={child}
                holder={nameOf(child.job.provider)}
                now={now}
                selected={selected === child.job.id}
                lit={hover === id}
                dim={hover !== null && hover !== id && hover !== rootId}
                onSelect={() => onSelect(child.job.id)}
                onHover={(on) => onHover(on ? id : null)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
