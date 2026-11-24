/**
 * SPDX-License-Identifier: MIT
 * The money map: who paid whom inside one job tree. Payer → root ticket → subcontract tickets,
 * joined by lines that carry the amount and turn blue when paid, red when refused.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { JobNode } from "@chainwork/types";
import { formatMoney } from "../lib/format";
import { Ticket, inkFor } from "./Ticket";

interface Edge {
  id: string;
  d: string;
  label: string;
  lx: number;
  ly: number;
  ink: string;
  dashed: boolean;
}

interface Props {
  tree: JobNode;
  now: number;
  nameOf(address: string): string;
  selected: bigint | null;
  onSelect(id: bigint): void;
}

export function FlowMap({ tree, now, nameOf, selected, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const payer = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLButtonElement>(null);
  const kids = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const childKey = tree.children.map((c) => `${c.job.id}:${c.ui}`).join(",");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const rightMid = (n: Element) => {
        const r = n.getBoundingClientRect();
        return { x: r.right - box.left, y: r.top - box.top + r.height / 2 };
      };
      const leftMid = (n: Element) => {
        const r = n.getBoundingClientRect();
        return { x: r.left - box.left, y: r.top - box.top + r.height / 2 };
      };
      const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const mx = (a.x + b.x) / 2;
        return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
      };
      const out: Edge[] = [];
      // Stacked (narrow) layout: no connectors, the order carries the meaning.
      const stacked = root.current && payer.current && root.current.getBoundingClientRect().left - payer.current.getBoundingClientRect().right < 24;
      if (!stacked && payer.current && root.current) {
        const a = rightMid(payer.current);
        const b = leftMid(root.current);
        out.push({
          id: "payer",
          d: curve(a, b),
          label: formatMoney(tree.job.budget),
          lx: (a.x + b.x) / 2,
          ly: Math.min(a.y, b.y) - 10,
          ink: "blue",
          dashed: false,
        });
      }
      if (!stacked && root.current) {
        const a = rightMid(root.current);
        for (const child of tree.children) {
          const n = kids.current.get(child.job.id.toString());
          if (!n) continue;
          const b = leftMid(n);
          const ink = inkFor(child.ui);
          out.push({
            id: child.job.id.toString(),
            d: curve(a, b),
            label: formatMoney(child.job.budget),
            lx: a.x + (b.x - a.x) * 0.72,
            ly: b.y - 9,
            ink,
            dashed: ink === "red",
          });
        }
      }
      setEdges(out);
      setSize({ w: box.width, h: box.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tree.job.id, tree.job.budget, childKey, tree.children]);

  const client = nameOf(tree.job.client);

  return (
    <div className="flow" ref={wrap}>
      <svg className="flow-lines" width={size.w} height={size.h} aria-hidden="true">
        {edges.map((e) => (
          <g key={e.id} className={`edge edge-${e.ink}`}>
            <path d={e.d} className={e.dashed ? "edge-path is-dashed" : "edge-path"} />
            <text x={e.lx} y={e.ly} textAnchor="middle" className="edge-label">
              {e.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="flow-col flow-col-payer">
        <div className="payer" ref={payer}>
          <span className="payer-who">{client}</span>
          <span className="payer-what">signed one payment into escrow, paid no gas</span>
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
          onSelect={() => onSelect(tree.job.id)}
        />
      </div>

      <div className="flow-col flow-col-kids">
        {tree.children.length === 0 ? (
          <p className="flow-empty">No subcontracts yet. When the provider hires help, each hire appears here, paid from this job's escrow.</p>
        ) : (
          tree.children.map((child) => (
            <Ticket
              key={child.job.id.toString()}
              ref={(n) => {
                if (n) kids.current.set(child.job.id.toString(), n);
                else kids.current.delete(child.job.id.toString());
              }}
              node={child}
              holder={nameOf(child.job.provider)}
              now={now}
              selected={selected === child.job.id}
              onSelect={() => onSelect(child.job.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
