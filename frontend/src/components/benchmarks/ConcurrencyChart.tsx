"use client";

interface CurvePoint {
  n: number;
  agg_tps: number;
  per_req_tps: number;
  p95_ttft_ms: number;
}

interface Props {
  curve: CurvePoint[];
}

const W = 320;
const H = 140;
const PAD = { top: 12, right: 44, bottom: 28, left: 44 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function ConcurrencyChart({ curve }: Props) {
  if (!curve.length) return null;

  const ns = curve.map((p) => p.n);
  const minN = Math.min(...ns);
  const maxN = Math.max(...ns);
  const maxTtft = Math.max(...curve.map((p) => p.p95_ttft_ms), 1);
  const maxTps = Math.max(...curve.map((p) => p.agg_tps), 1);

  function xScale(n: number) {
    if (minN === maxN) return PAD.left + INNER_W / 2;
    return PAD.left + ((n - minN) / (maxN - minN)) * INNER_W;
  }
  function yTtft(v: number) {
    return PAD.top + INNER_H - (v / maxTtft) * INNER_H;
  }
  function yTps(v: number) {
    return PAD.top + INNER_H - (v / maxTps) * INNER_H;
  }

  const ttftPoints = curve.map((p) => [xScale(p.n), yTtft(p.p95_ttft_ms)] as [number, number]);
  const tpsPoints = curve.map((p) => [xScale(p.n), yTps(p.agg_tps)] as [number, number]);

  // Y-axis ticks (3 ticks each side)
  const ttftTicks = [0, 0.5, 1].map((t) => ({
    v: Math.round(maxTtft * t),
    y: yTtft(maxTtft * t),
  }));
  const tpsTicks = [0, 0.5, 1].map((t) => ({
    v: Math.round(maxTps * t),
    y: yTps(maxTps * t),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ maxHeight: H }}>
      {/* Grid lines */}
      {ttftTicks.map((t) => (
        <line key={t.v} x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
          stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
      ))}

      {/* TTFT line (red) */}
      <path d={linePath(ttftPoints)} fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {ttftPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#f87171">
          <title>n={curve[i].n} · p95 TTFT={curve[i].p95_ttft_ms.toFixed(0)}ms</title>
        </circle>
      ))}

      {/* TPS line (green) */}
      <path d={linePath(tpsPoints)} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {tpsPoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#34d399">
          <title>n={curve[i].n} · agg TPS={curve[i].agg_tps.toFixed(1)}</title>
        </circle>
      ))}

      {/* Left y-axis labels (TTFT ms) */}
      {ttftTicks.slice(1).map((t) => (
        <text key={t.v} x={PAD.left - 4} y={t.y + 4} textAnchor="end"
          fontSize="9" fill="currentColor" opacity="0.5">{t.v}</text>
      ))}

      {/* Right y-axis labels (TPS) */}
      {tpsTicks.slice(1).map((t) => (
        <text key={t.v} x={W - PAD.right + 4} y={t.y + 4} textAnchor="start"
          fontSize="9" fill="currentColor" opacity="0.5">{t.v}</text>
      ))}

      {/* X-axis labels */}
      {curve.map((p) => (
        <text key={p.n} x={xScale(p.n)} y={H - 6} textAnchor="middle"
          fontSize="9" fill="currentColor" opacity="0.5">{p.n}</text>
      ))}

      {/* Axis labels */}
      <text x={4} y={PAD.top + 2} fontSize="8" fill="#f87171" opacity="0.8">ms</text>
      <text x={W - 4} y={PAD.top + 2} textAnchor="end" fontSize="8" fill="#34d399" opacity="0.8">t/s</text>
      <text x={W / 2} y={H - 1} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.4">concurrency</text>
    </svg>
  );
}
