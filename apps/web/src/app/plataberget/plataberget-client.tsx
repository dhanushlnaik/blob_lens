"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { EChartsOption } from "echarts";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { DottedCard } from "@/components/ui/dotted-card";
import { EChartWrapper } from "@/components/charts/echart-wrapper";

type Impact = {
  network: { name: string; rpc: string; blocks_indexed: number | string; last_block: number | string | null };
  devnet: { gas_limit: number; gas_used: number; gas_util: number; tx_per_block: number; blobs_per_block: number; base_fee_gwei: number };
  mainnet: { gas_limit: number; gas_used: number; gas_util: number; tx_per_block: number; blobs_per_block: number; base_fee_gwei: number };
  projection: { capacity_ratio: number | null; projected_mainnet_tx_per_block: number | null; note: string };
  ramp: { block: number; gas_limit: number; gas_used: number; tx_count: number; blob_count: number }[];
  eips: { id: string; label: string }[];
  disclaimer: string;
  methodology?: {
    devnet: { table: string; source_rpc: string; window_blocks: number; window_first_block: number | string | null; window_last_block: number | string | null; samples: number | string; verified_against: string };
    mainnet: { tables: string[]; window_blocks: number; window_first_block: number | string | null; window_last_block: number | string | null; samples: number | string };
    formulas: { capacity_ratio: string; projected_tx_per_block: string; gas_util: string; dedup: string };
  };
};

// Plataberget testnet = purple, mainnet today = grey. Blobs = amber. Consistent everywhere.
const C = { test: "#7C5CFF", main: "#94A3B8", blob: "#D97706" };
const M = (n: number) => `${(n / 1e6).toFixed(0)}M`;
const LEGEND = { top: 0, itemWidth: 11, itemHeight: 11, textStyle: { fontSize: 11, fontFamily: "var(--font-mono)" } };

function HowToRead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-[12.5px] leading-relaxed">
      <span className="font-mono text-[10px] uppercase tracking-wider mt-0.5 shrink-0 text-[var(--text-muted)]">How to read</span>
      <span className="text-[var(--text-secondary)]">{children}</span>
    </p>
  );
}

export function PlatabergetClient() {
  const [data, setData] = useState<Impact | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plataberget")
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const legendColor = dark ? "#A0A0B2" : "#55556B";
  const labelColor = dark ? "#E5E5E7" : "#1A1A24";
  const ax = {
    axisLine: { lineStyle: { color: dark ? "#22222E" : "#E5E5E7" } },
    axisLabel: { color: dark ? "#8A8A9E" : "#6B6B7E", fontFamily: "var(--font-mono)", fontSize: 11 },
    splitLine: { lineStyle: { color: dark ? "#1A1A24" : "#F3F3F7", type: "dashed" as const } },
  };
  const tt = {
    backgroundColor: dark ? "#0E0E14" : "#ffffff",
    borderColor: dark ? "#22222E" : "#E5E5E7",
    textStyle: { color: labelColor, fontFamily: "var(--font-mono)", fontSize: 11 },
  };
  const blockAxis = { type: "category" as const, ...ax, axisLabel: { ...ax.axisLabel, interval: (i: number) => i % 10 === 0, formatter: (v: string) => `${(Number(v) / 1000).toFixed(0)}k` } };

  // HERO: block capacity scaling from 60M to 200M over the network's life.
  const rampOption = useMemo<EChartsOption>(() => {
    if (!data) return {} as EChartsOption;
    const r = data.ramp;
    const mainCap = data.mainnet.gas_limit;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tt, formatter: (ps: { value: number; seriesName: string; axisValue: string }[]) => `block ${Number(ps[0]?.axisValue).toLocaleString()}<br/>${ps.filter((p) => p.seriesName !== "Mainnet capacity today").map((p) => `${p.seriesName}: <b>${M(p.value)}</b>`).join("<br/>")}` },
      legend: { data: ["Block capacity (gas limit)", "Gas actually used", "Mainnet capacity today"], ...LEGEND, textStyle: { ...LEGEND.textStyle, color: legendColor } },
      grid: { top: 36, right: 20, bottom: 30, left: 14, containLabel: true },
      xAxis: { ...blockAxis, data: r.map((p) => p.block), name: "testnet block", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: ax.axisLabel.color, fontSize: 10, fontFamily: "var(--font-mono)" } },
      yAxis: { type: "value", ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => M(v) } },
      series: [
        { name: "Gas actually used", type: "line", smooth: true, symbol: "none", data: r.map((p) => p.gas_used), areaStyle: { color: dark ? "rgba(124,92,255,0.20)" : "rgba(124,92,255,0.12)" }, lineStyle: { color: C.test, width: 1.5, opacity: 0.7 }, itemStyle: { color: C.test } },
        { name: "Block capacity (gas limit)", type: "line", step: "end", symbol: "none", data: r.map((p) => p.gas_limit), lineStyle: { color: C.test, width: 2.5 }, itemStyle: { color: C.test } },
        { name: "Mainnet capacity today", type: "line", symbol: "none", data: r.map(() => mainCap), lineStyle: { color: C.main, width: 1.5, type: "dashed" }, itemStyle: { color: C.main } },
      ],
    } as unknown as EChartsOption;
  }, [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Direct side-by-side: testnet vs mainnet on shared gas units.
  const compareOption = useMemo<EChartsOption>(() => {
    if (!data) return {} as EChartsOption;
    const fmt = (v: number) => M(v);
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tt, axisPointer: { type: "shadow" }, formatter: (ps: { seriesName: string; value: number; axisValue: string }[]) => `${ps[0]?.axisValue}<br/>${ps.map((p) => `${p.seriesName}: <b>${fmt(p.value)}</b>`).join("<br/>")}` },
      legend: { data: ["Mainnet today", "Platåberget testnet"], ...LEGEND, textStyle: { ...LEGEND.textStyle, color: legendColor } },
      grid: { top: 34, right: 16, bottom: 20, left: 12, containLabel: true },
      xAxis: { type: "category", data: ["Block capacity\n(max gas)", "Gas used\nper block"], ...ax, axisLabel: { ...ax.axisLabel, fontSize: 12, lineHeight: 15 } },
      yAxis: { type: "value", ...ax, axisLabel: { ...ax.axisLabel, formatter: fmt } },
      series: [
        { name: "Mainnet today", type: "bar", barGap: "20%", barWidth: "30%", data: [data.mainnet.gas_limit, data.mainnet.gas_used], itemStyle: { color: C.main, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: ax.axisLabel.color, fontFamily: "var(--font-mono)", fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) } },
        { name: "Platåberget testnet", type: "bar", barWidth: "30%", data: [data.devnet.gas_limit, data.devnet.gas_used], itemStyle: { color: C.test, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: "top", color: C.test, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: "bold", formatter: (p: { value: number }) => fmt(p.value) } },
      ],
    } as unknown as EChartsOption;
  }, [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Block fullness, testnet vs mainnet.
  const fullnessOption = useMemo<EChartsOption>(() => {
    if (!data) return {} as EChartsOption;
    const dv = Math.round(data.devnet.gas_util * 100);
    const mn = Math.round(data.mainnet.gas_util * 100);
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tt, axisPointer: { type: "shadow" }, formatter: (ps: { name: string; value: number }[]) => `${ps[0]?.name}: <b>${ps[0]?.value}% full</b>` },
      grid: { top: 10, right: 44, bottom: 10, left: 12, containLabel: true },
      xAxis: { type: "value", max: 100, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${v}%` } },
      yAxis: { type: "category", data: ["Mainnet today", "Platåberget testnet"], ...ax, axisLabel: { ...ax.axisLabel, fontSize: 12 } },
      series: [{
        type: "bar", barWidth: "48%",
        data: [{ value: mn, itemStyle: { color: C.main } }, { value: dv, itemStyle: { color: C.test } }],
        label: { show: true, position: "right", color: labelColor, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: "bold", formatter: "{c}%" },
      }],
    } as unknown as EChartsOption;
  }, [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transactions per block over the network's life.
  const txOption = useMemo<EChartsOption>(() => {
    if (!data) return {} as EChartsOption;
    const r = data.ramp;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tt, formatter: (ps: { value: number; axisValue: string }[]) => `block ${Number(ps[0]?.axisValue).toLocaleString()}<br/>Transactions: <b>${Math.round(Number(ps[0]?.value))}</b>` },
      grid: { top: 12, right: 16, bottom: 26, left: 12, containLabel: true },
      xAxis: { ...blockAxis, data: r.map((p) => p.block) },
      yAxis: { type: "value", ...ax },
      series: [{ name: "Transactions per block", type: "line", smooth: true, symbol: "none", data: r.map((p) => p.tx_count), areaStyle: { color: dark ? "rgba(124,92,255,0.18)" : "rgba(124,92,255,0.10)" }, lineStyle: { color: C.test, width: 2 }, itemStyle: { color: C.test } }],
    } as unknown as EChartsOption;
  }, [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blobs per block over the network's life (rollup data availability).
  const blobOption = useMemo<EChartsOption>(() => {
    if (!data) return {} as EChartsOption;
    const r = data.ramp;
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", ...tt, formatter: (ps: { value: number; axisValue: string }[]) => `block ${Number(ps[0]?.axisValue).toLocaleString()}<br/>Blobs: <b>${Number(ps[0]?.value).toFixed(1)}</b> / block` },
      grid: { top: 12, right: 16, bottom: 26, left: 12, containLabel: true },
      xAxis: { ...blockAxis, data: r.map((p) => p.block) },
      yAxis: { type: "value", ...ax },
      series: [{ name: "Blobs per block", type: "line", smooth: true, symbol: "none", data: r.map((p) => p.blob_count), areaStyle: { color: dark ? "rgba(217,119,6,0.18)" : "rgba(217,119,6,0.10)" }, lineStyle: { color: C.blob, width: 2 }, itemStyle: { color: C.blob } }],
    } as unknown as EChartsOption;
  }, [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Horizontal 2-bar comparison builder (mainnet vs testnet).
  const hCompare = (mnVal: number, tsVal: number, label: (v: number) => string, maxV?: number): EChartsOption => ({
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", ...tt, axisPointer: { type: "shadow" }, formatter: (ps: { name: string; value: number }[]) => `${ps[0]?.name}: <b>${label(ps[0]?.value)}</b>` },
    grid: { top: 10, right: 64, bottom: 10, left: 12, containLabel: true },
    xAxis: { type: "value", max: maxV, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => label(v) } },
    yAxis: { type: "category", data: ["Mainnet today", "Platåberget testnet"], ...ax, axisLabel: { ...ax.axisLabel, fontSize: 12 } },
    series: [{
      type: "bar", barWidth: "48%",
      data: [{ value: mnVal, itemStyle: { color: C.main } }, { value: tsVal, itemStyle: { color: C.test } }],
      label: { show: true, position: "right", color: labelColor, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: "bold", formatter: (p: { value: number }) => label(p.value) },
    }],
  } as unknown as EChartsOption);

  const baseFeeOption = useMemo<EChartsOption>(() => (data ? hCompare(data.mainnet.base_fee_gwei, data.devnet.base_fee_gwei, (v) => `${v.toFixed(3)} gwei`) : ({} as EChartsOption)), [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const blobsCompareOption = useMemo<EChartsOption>(() => (data ? hCompare(data.mainnet.blobs_per_block, data.devnet.blobs_per_block, (v) => `${v.toFixed(1)}`) : ({} as EChartsOption)), [data, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="font-mono text-xs text-[var(--warning)] py-12">[ ERROR ] {err}</div>;
  if (!data) return <div className="font-mono text-xs text-[var(--text-muted)] py-12 animate-pulse tracking-widest">[ LOADING TESTNET IMPACT... ]</div>;

  const { devnet, mainnet, eips, network } = data;
  const ratio = data.projection.capacity_ratio ?? 0;

  return (
    <div className="max-w-7xl mx-auto pt-6 space-y-6">
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Platåberget Impact</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning)] px-2.5 py-0.5 text-[11px] font-mono uppercase text-[var(--warning)]">
            <AlertTriangle className="h-3 w-3" /> Testnet projection
          </span>
        </div>
        <p className="w-full text-[15px] leading-relaxed text-[var(--text-secondary)]">
          The next Ethereum upgrade makes every block bigger. On the live Platåberget testnet, block capacity has scaled to about
          <span className="font-semibold text-[var(--text-primary)]"> {ratio.toFixed(1)}x</span> mainnet today.
          <span className="ml-2 inline-flex items-center gap-3 align-middle text-[12px] font-mono text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.main }} />mainnet today</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.test }} />Platåberget testnet</span>
          </span>
        </p>
      </header>

      {/* Big stat strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { k: "Block capacity now", v: M(mainnet.gas_limit), s: "gas / block (mainnet)" },
          { k: "Block capacity after", v: M(devnet.gas_limit), s: "gas / block (testnet)", hi: true },
          { k: "Capacity gain", v: `${ratio.toFixed(1)}x`, s: "more room per block", hi: true },
          { k: "Block time", v: "~12s", s: "unchanged" },
        ].map((x) => (
          <div key={x.k} className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
            <div className="text-[11px] font-mono uppercase text-[var(--text-muted)]">{x.k}</div>
            <div className={`font-mono text-2xl font-bold ${x.hi ? "text-[var(--primary-text)]" : "text-[var(--text-primary)]"}`}>{x.v}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{x.s}</div>
          </div>
        ))}
      </div>

      {/* HERO */}
      <DottedCard title="Block capacity, scaling up on the testnet" subtitle="Every Platåberget block, from launch to now" badge="Live testnet" badgeType="live" techBracket>
        <EChartWrapper option={rampOption} style={{ height: "340px", width: "100%" }} showFooter={false} />
        <HowToRead>
          The bold purple line is the maximum size of each Platåberget block. It stepped up from mainnet&apos;s level to about <span className="font-mono">{M(devnet.gas_limit)}</span>, roughly <span className="font-mono">{ratio.toFixed(1)}x</span> more.
          The grey dashed line is all a mainnet block can hold today. The shaded area is how much each block actually uses, already well above the grey line, so the extra capacity is real, not theoretical.
        </HowToRead>
      </DottedCard>

      {/* Two-up: comparison + fullness */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DottedCard title="Testnet vs mainnet, side by side" subtitle="Same measures, today vs the upgrade" techBracket>
          <EChartWrapper option={compareOption} style={{ height: "250px", width: "100%" }} showFooter={false} />
          <HowToRead>Mainnet (grey) next to Platåberget (purple). The purple bars are about <span className="font-mono">{ratio.toFixed(1)}x</span> taller, meaning bigger blocks doing more work each. Gas just measures block space and computation.</HowToRead>
        </DottedCard>

        <DottedCard title="The bigger blocks are genuinely full" subtitle="How full blocks run" techBracket>
          <EChartWrapper option={fullnessOption} style={{ height: "150px", width: "100%" }} showFooter={false} />
          <div className="mt-3 flex flex-wrap items-baseline gap-2 border-t border-[var(--border)] pt-3">
            <span className="text-[13px] text-[var(--text-secondary)]">Transactions per block, on average:</span>
            <span className="font-mono text-[var(--text-primary)]">{Math.round(mainnet.tx_per_block)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="font-mono font-semibold text-[var(--primary-text)]">room for ~{ratio.toFixed(1)}x more</span>
          </div>
          <HowToRead>Both networks run their blocks about equally full, so the testnet is not an empty big block. It does a similar share of work on a block roughly <span className="font-mono">{ratio.toFixed(1)}x</span> larger, leaving room for far more transactions.</HowToRead>
        </DottedCard>
      </div>

      {/* Two-up: transactions + blobs over time */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DottedCard title="Transactions per block over time" subtitle="Activity on the Platåberget testnet" techBracket>
          <EChartWrapper option={txOption} style={{ height: "210px", width: "100%" }} showFooter={false} />
          <HowToRead>Each point is the average transactions in a block as the testnet runs. It shows real usage building, all comfortably inside the bigger blocks.</HowToRead>
        </DottedCard>

        <DottedCard title="Blobs per block over time" subtitle="Rollup data throughput" techBracket>
          <EChartWrapper option={blobOption} style={{ height: "210px", width: "100%" }} showFooter={false} />
          <HowToRead>Blobs carry rollup data on Ethereum. Each point is the average blobs per block, showing data availability alongside the gas and block-size changes.</HowToRead>
        </DottedCard>
      </div>

      {/* Two-up: fee + blobs comparison */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DottedCard title="Base fee, testnet vs mainnet" subtitle="What one unit of gas costs" techBracket>
          <EChartWrapper option={baseFeeOption} style={{ height: "150px", width: "100%" }} showFooter={false} />
          <HowToRead>The base fee is the price of block space. With far more room per block, the Platåberget testnet&apos;s fee sits well below mainnet&apos;s. Real mainnet fees depend on demand, but bigger blocks relieve the pressure that pushes them up.</HowToRead>
        </DottedCard>

        <DottedCard title="Blobs per block, testnet vs mainnet" subtitle="Rollup data carried per block" techBracket>
          <EChartWrapper option={blobsCompareOption} style={{ height: "150px", width: "100%" }} showFooter={false} />
          <HowToRead>Blobs are the cheap data slots rollups post to Ethereum. The testnet is carrying more blobs per block than mainnet today, so rollups get more room for their data alongside the bigger blocks.</HowToRead>
        </DottedCard>
      </div>

      {/* What's changing */}
      <DottedCard title="What's driving this" subtitle="The upgrade changes behind the numbers" techBracket>
        <ul className="mt-1 grid gap-1.5 sm:grid-cols-2">
          {eips.map((e) => {
            const num = e.id.match(/EIP-(\d+)/)?.[1];
            const body = (
              <span className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-[var(--text-muted)] shrink-0" />
                <span><span className="font-mono text-[var(--primary-text)]">{e.id}</span>: {e.label}</span>
              </span>
            );
            return <li key={e.id}>{num ? <Link href={`https://eipsinsight.com/eips/${num}`} target="_blank" className="hover:underline decoration-dotted">{body}</Link> : body}</li>;
          })}
        </ul>
      </DottedCard>

      {/* Methodology & verification — for researchers who want to reproduce/validate */}
      {data.methodology && (
        <DottedCard title="Methodology & verification" subtitle="Every number, and how to reproduce it" badge="For reviewers" badgeType="iris" techBracket>
          <div className="mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[13px] text-[var(--text-secondary)]">
            The devnet numbers are verified <span className="font-semibold text-[var(--text-primary)]">block-by-block against ethpandaops Dora</span>.{" "}
            <Link href="/validate" className="font-mono text-[var(--primary-text)] underline decoration-dotted">Open the live validation tool →</Link>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="rounded-md bg-[var(--surface-sunken)] p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Testnet (Platåberget)</div>
              <dl className="mt-1.5 space-y-1 text-[12.5px]">
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">table</dt><dd className="font-mono text-[var(--text-secondary)]">{data.methodology.devnet.table}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">source</dt><dd className="font-mono text-[var(--text-secondary)]">{data.methodology.devnet.source_rpc}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">window</dt><dd className="font-mono text-[var(--text-secondary)]">{Number(data.methodology.devnet.samples).toLocaleString()} blocks · {Number(data.methodology.devnet.window_first_block).toLocaleString()}–{Number(data.methodology.devnet.window_last_block).toLocaleString()}</dd></div>
              </dl>
            </div>
            <div className="rounded-md bg-[var(--surface-sunken)] p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Mainnet baseline</div>
              <dl className="mt-1.5 space-y-1 text-[12.5px]">
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">tables</dt><dd className="font-mono text-right text-[var(--text-secondary)]">{data.methodology.mainnet.tables.join(", ")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">window</dt><dd className="font-mono text-[var(--text-secondary)]">{Number(data.methodology.mainnet.samples).toLocaleString()} blocks · {Number(data.methodology.mainnet.window_first_block).toLocaleString()}–{Number(data.methodology.mainnet.window_last_block).toLocaleString()}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">dedup</dt><dd className="font-mono text-[var(--text-secondary)]">ReplacingMergeTree FINAL</dd></div>
              </dl>
            </div>
          </div>

          <div className="mt-3 space-y-1.5 text-[12.5px] text-[var(--text-secondary)]">
            <p><span className="font-mono text-[var(--text-muted)]">capacity ratio</span> = avg(testnet gas_limit) / avg(mainnet gas_limit) = <span className="font-mono text-[var(--text-primary)]">{M(devnet.gas_limit)} / {M(mainnet.gas_limit)} = {ratio.toFixed(2)}x</span></p>
            <p><span className="font-mono text-[var(--text-muted)]">projected tx/block</span> = avg(mainnet tx/block) × capacity ratio = <span className="font-mono text-[var(--text-primary)]">{Math.round(mainnet.tx_per_block)} × {ratio.toFixed(2)} ≈ {data.projection.projected_mainnet_tx_per_block}</span></p>
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              <span>The tx projection is a <span className="font-semibold">naive linear scaling</span>: it assumes per-transaction gas is unchanged and does <span className="font-semibold">not</span> model Glamsterdam&apos;s gas repricing (EIP-7778 / 8037 / 2780 / 7904). Read it as capacity headroom, not a demand forecast.</span>
            </p>
          </div>
        </DottedCard>
      )}

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
        <span>{Number(network.blocks_indexed).toLocaleString()} testnet blocks measured · block {Number(network.last_block ?? 0).toLocaleString()} · {network.rpc}</span>
        <span className="text-right">{data.disclaimer}</span>
      </div>
    </div>
  );
}
