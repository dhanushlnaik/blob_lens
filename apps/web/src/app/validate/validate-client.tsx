"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { DottedCard } from "@/components/ui/dotted-card";

type Metrics = { blob: number; tx: number; gasUsed: number; gasLimit: number };
type Row = {
  block: number;
  ts: number;
  ours: Metrics | null;
  dora: Metrics | null;
  match: { blob: boolean; tx: boolean; gasUsed: boolean; gasLimit: boolean } | null;
  allMatch: boolean;
  note?: string;
};
type Result = {
  network: { name: string; dora: string };
  health: {
    our_max_block: number;
    dora_head_block: number;
    indexer_lag_blocks: number;
    total_rows: number;
    distinct_blocks: number;
    duplicate_rows: number;
  };
  window: { lo: number; hi: number };
  totals: {
    compared_blocks: number;
    window_requested: number;
    matched_blocks: number;
    mismatched_blocks: number;
    uncovered_blocks: number;
    per_metric_mismatch: { blob: number; tx: number; gasUsed: number; gasLimit: number };
    blobs: { ours: number; dora: number };
    txs: { ours: number; dora: number };
    gas_used: { ours: number; dora: number };
  };
  rows: Row[];
  error?: string;
};

const WINDOWS = [100, 300, 1000, 2000];
const fmt = (n: number) => n.toLocaleString("en-US");

function pct(a: number, b: number) {
  if (a === 0 && b === 0) return 100;
  const hi = Math.max(a, b);
  if (hi === 0) return 100;
  return (1 - Math.abs(a - b) / hi) * 100;
}

function ParityCard({
  label,
  ours,
  dora,
  fmtVal = fmt,
}: {
  label: string;
  ours: number;
  dora: number;
  fmtVal?: (n: number) => string;
}) {
  const match = ours === dora;
  const p = pct(ours, dora);
  return (
    <DottedCard techBracket>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
        {match ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <span className="font-mono text-[10px] text-amber-500">{p.toFixed(2)}%</span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">ours</span>
          <span className="font-mono text-sm text-[var(--text-primary)]">{fmtVal(ours)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">dora</span>
          <span className="font-mono text-sm text-[var(--text-primary)]">{fmtVal(dora)}</span>
        </div>
      </div>
      <div className={`mt-2 font-mono text-[11px] ${match ? "text-emerald-500" : "text-amber-500"}`}>
        {match ? "exact match" : `Δ ${fmt(Math.abs(ours - dora))}`}
      </div>
    </DottedCard>
  );
}

function Cell({ ours, dora, ok }: { ours: number; dora: number; ok: boolean }) {
  return (
    <td className={`px-3 py-1.5 font-mono text-[12px] tabular-nums ${ok ? "" : "bg-red-500/10"}`}>
      <span className={ok ? "text-[var(--text-secondary)]" : "text-red-500 font-semibold"}>{fmt(ours)}</span>
      {!ok && <span className="text-[var(--text-muted)]"> ≠ {fmt(dora)}</span>}
    </td>
  );
}

export function ValidateClient() {
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [window, setWindow] = useState(300);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/validate?window=${window}`)
      .then((r) => r.json())
      .then((d: Result) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [window]);

  if (err) {
    return (
      <div className="mx-auto max-w-2xl mt-10 rounded-lg border border-red-500/30 bg-red-500/5 p-4 font-mono text-sm text-red-500">
        {err}
      </div>
    );
  }

  const h = data?.health;
  const t = data?.totals;
  const allGreen = t ? t.mismatched_blocks === 0 && t.uncovered_blocks === 0 : false;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pt-2">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">Data Validation vs Dora</h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Block-by-block parity between BlobLens and{" "}
            <Link
              href={data ? `${data.network.dora}/blobs` : "#"}
              target="_blank"
              className="inline-flex items-center gap-0.5 text-[var(--text-primary)] underline decoration-dotted underline-offset-2"
            >
              ethpandaops Dora <ExternalLink className="h-3 w-3" />
            </Link>{" "}
            for {data?.network.name ?? "the devnet"}.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                window === w
                  ? "border-[var(--accent-iris)] text-[var(--text-primary)]"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {w} blk
            </button>
          ))}
        </div>
      </div>

      {/* Verdict banner */}
      {t && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
            allGreen
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          {allGreen ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          )}
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {allGreen
              ? `Verified — ${fmt(t.matched_blocks)}/${fmt(t.compared_blocks)} blocks match Dora exactly on blobs, txs, gas used and gas limit.`
              : `${fmt(t.matched_blocks)}/${fmt(t.compared_blocks)} blocks match; ${fmt(t.mismatched_blocks)} mismatched, ${fmt(t.uncovered_blocks)} not covered by Dora.`}
          </span>
          {loading && <RefreshCw className="ml-auto h-4 w-4 animate-spin text-[var(--text-muted)]" />}
        </div>
      )}

      {/* Health strip */}
      {h && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">our head block</div>
            <div className="font-mono text-sm text-[var(--text-primary)]">{fmt(h.our_max_block)}</div>
          </div>
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">dora head block</div>
            <div className="font-mono text-sm text-[var(--text-primary)]">{fmt(h.dora_head_block)}</div>
          </div>
          <div className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">indexer lag</div>
            <div className="font-mono text-sm text-[var(--text-primary)]">{fmt(h.indexer_lag_blocks)} blk</div>
          </div>
          <div
            className={`rounded-md border px-3 py-2 ${
              h.duplicate_rows > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-[var(--border)]"
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">duplicate rows</div>
            <div className={`font-mono text-sm ${h.duplicate_rows > 0 ? "text-amber-500" : "text-emerald-500"}`}>
              {fmt(h.duplicate_rows)}
              <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                ({fmt(h.total_rows)} rows / {fmt(h.distinct_blocks)} blocks)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Aggregate parity */}
      {t && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ParityCard label={`total blobs · ${fmt(t.compared_blocks)} blk`} ours={t.blobs.ours} dora={t.blobs.dora} />
          <ParityCard label="total transactions" ours={t.txs.ours} dora={t.txs.dora} />
          <ParityCard label="total gas used" ours={t.gas_used.ours} dora={t.gas_used.dora} />
        </div>
      )}

      {/* Per-block diff table */}
      {data && (
        <DottedCard title="Per-block diff" subtitle="Newest overlapping blocks — mismatches highlighted" techBracket>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="px-3 py-1.5">block</th>
                  <th className="px-3 py-1.5">blobs</th>
                  <th className="px-3 py-1.5">txs</th>
                  <th className="px-3 py-1.5">gas used</th>
                  <th className="px-3 py-1.5">gas limit</th>
                  <th className="px-3 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.block} className="border-b border-[var(--border)]/50">
                    <td className="px-3 py-1.5 font-mono text-[12px] text-[var(--text-primary)] tabular-nums">{fmt(r.block)}</td>
                    {r.ours && r.dora && r.match ? (
                      <>
                        <Cell ours={r.ours.blob} dora={r.dora.blob} ok={r.match.blob} />
                        <Cell ours={r.ours.tx} dora={r.dora.tx} ok={r.match.tx} />
                        <Cell ours={r.ours.gasUsed} dora={r.dora.gasUsed} ok={r.match.gasUsed} />
                        <Cell ours={r.ours.gasLimit} dora={r.dora.gasLimit} ok={r.match.gasLimit} />
                        <td className="px-3 py-1.5">
                          {r.allMatch ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                        {r.note ?? "no Dora data"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DottedCard>
      )}
    </div>
  );
}
