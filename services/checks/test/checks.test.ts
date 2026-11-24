import { describe, expect, it } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  MAX_SUMMARY_CHARS,
  buildDataset,
  buildPack,
  canonicalJson,
  datasetShapeError,
  hashJson,
  hashText,
  jobSpecDescription,
  metricsFor,
  parseJobSpec,
  verifyOutput,
} from "../src/index.js";
import type { Dataset, Metrics } from "../src/index.js";

const S = "0x1111111111111111111111111111111111111111" as Address;
const A = "0x2222222222222222222222222222222222222222" as Address;
const B = "0x3333333333333333333333333333333333333333" as Address;
const TOKEN = "0x456569838f1d43009A91ebA4263147Afd7233483" as Address;

const dataset = buildDataset({ subject: S, token: TOKEN, fromBlock: 0, toBlock: 100 }, [
  { b: 1, i: 0, from: S, to: A, value: "100000" },
  { b: 2, i: 0, from: B, to: S, value: "50000" },
  { b: 3, i: 0, from: S, to: A, value: "300000" },
]);

describe("canonical JSON", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalJson({ b: 2, a: [1, { d: true, c: null }] })).toBe('{"a":[1,{"c":null,"d":true}],"b":2}');
    expect(hashJson({ a: 1 })).toBe(hashText('{"a":1}'));
  });

  it("refuses bigints in amounts", () => {
    expect(() => canonicalJson({ value: 1n })).toThrow(/bigint/i);
  });
});

describe("dataset and metrics", () => {
  it("computes the metrics function exactly as the spec says", () => {
    expect(datasetShapeError(dataset)).toBeUndefined();
    const m = metricsFor(dataset);
    expect(m.count).toBe(3);
    expect(m.counterparties).toBe(2);
    expect(m.inflow).toBe("50000");
    expect(m.outflow).toBe("400000");
    expect(m.largest).toBe("300000");
    expect(m.topCounterpartyShareBps).toBe(8888); // 400000 / 450000
    expect(m.flags).toEqual(["CONCENTRATED", "LARGE_SINGLE"]);
    expect(m.datasetHash).toBe(hashJson(dataset));
  });

  it("flags thin history", () => {
    const thin = buildDataset({ subject: S, token: TOKEN, fromBlock: 0, toBlock: 10 }, [
      { b: 1, i: 0, from: S, to: A, value: "100" },
    ]);
    expect(metricsFor(thin).flags).toEqual(["CONCENTRATED", "LARGE_SINGLE", "THIN_HISTORY"]);
  });

  it("treats an empty history as zero volume, no flags", () => {
    const empty = buildDataset({ subject: S, token: TOKEN, fromBlock: 0, toBlock: 10 }, []);
    const m = metricsFor(empty);
    expect(m).toMatchObject({ count: 0, counterparties: 0, inflow: "0", outflow: "0", largest: "0", topCounterpartyShareBps: 0 });
    expect(m.flags).toEqual(["THIN_HISTORY"]);
  });
});

describe("job specs", () => {
  it("round-trips a canonical description", () => {
    const spec = { v: 1, kind: "dataset", subject: S, token: TOKEN, fromBlock: 5, toBlock: 42 } as const;
    expect(parseJobSpec(jobSpecDescription(spec))).toEqual(spec);
  });

  it("rejects human text and bad ranges", () => {
    expect(parseJobSpec("Please analyse this")).toBeUndefined();
    expect(parseJobSpec('{"v":1,"kind":"dataset","subject":"0x1","token":"0x2","fromBlock":9,"toBlock":1}')).toBeUndefined();
  });
});

describe("output verification", () => {
  const metrics = metricsFor(dataset);

  const context = (overrides: Partial<Parameters<typeof verifyOutput>[2]> = {}) => {
    const outputs = new Map<bigint, string>([
      [1n, canonicalJson(dataset)],
      [2n, canonicalJson(metrics)],
    ]);
    return {
      pc: {} as PublicClient,
      token: TOKEN,
      jobId: 3n,
      childJobIds: [1n, 2n],
      fetchOutput: async (id: bigint) => outputs.get(id) ?? "",
      childrenRoot: hashJson({ children: [dataset, metrics] }),
      ...overrides,
    };
  };

  it("accepts metrics recomputed from the dataset", async () => {
    const metricsSpec = { v: 1, kind: "metrics", subject: S } as const;
    expect(await verifyOutput(metricsSpec, canonicalJson(metrics), context())).toEqual({ ok: true });
  });

  it("rejects a hallucinated metrics document", async () => {
    const bad: Metrics = { ...metrics, inflow: "999999", flags: [] };
    const metricsSpec = { v: 1, kind: "metrics", subject: S } as const;
    const result = await verifyOutput(metricsSpec, canonicalJson(bad), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/do not match the dataset/);
  });

  it("rejects a pack whose childrenRoot differs from the escrow", async () => {
    const pack = buildPack({
      subject: S,
      childrenRoot: hashJson({ children: [dataset, metrics] }),
      datasetHash: hashJson(dataset),
      metricsHash: hashJson(metrics),
      summary: "A supplier with concentrated flows.",
    });
    const spec = { v: 1, kind: "pack", subject: S } as const;
    expect(await verifyOutput(spec, canonicalJson(pack), context())).toEqual({ ok: true });

    const wrong = { ...pack, childrenRoot: hashJson({ other: true }) };
    const result = await verifyOutput(spec, canonicalJson(wrong), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/childrenRoot/);
  });

  it("enforces the summary length", () => {
    expect(() =>
      buildPack({
        subject: S,
        childrenRoot: hashJson({}),
        datasetHash: hashJson(dataset),
        metricsHash: hashJson(metrics),
        summary: "x".repeat(MAX_SUMMARY_CHARS + 1),
      }),
    ).toThrow();
  });

  it("re-checks a dataset against the chain log", async () => {
    const logs = [
      { blockNumber: 1n, logIndex: 0, args: { from: S, to: A, value: 100000n } },
      { blockNumber: 2n, logIndex: 0, args: { from: B, to: S, value: 50000n } },
      { blockNumber: 3n, logIndex: 0, args: { from: S, to: A, value: 300000n } },
    ];
    const pc = { getLogs: async () => logs } as unknown as PublicClient;
    const spec = { v: 1, kind: "dataset", subject: S, token: TOKEN, fromBlock: 0, toBlock: 100 } as const;
    expect(await verifyOutput(spec, canonicalJson(dataset), context({ pc }))).toEqual({ ok: true });

    const tampered: Dataset = { ...dataset, transfers: dataset.transfers.slice(1) };
    const result = await verifyOutput(spec, canonicalJson(tampered), context({ pc }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not match the chain/);
  });
});
