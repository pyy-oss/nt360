// Graphes Recharts thématisés Forest & Gold (mirroir du prototype).
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { T, BU_COL, fmt, fmtFull } from "./tokens";

const legendStyle = { fontSize: 12, color: T.dim } as const;

export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 text-xs shadow-card">
      {label != null && <div className="text-muted mb-1">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="tabnum" style={{ color: p.color || T.ink }}>{p.name}: <b>{fmtFull(p.value)}</b> FCFA</div>
      ))}
    </div>
  );
}

const axis = { stroke: T.dim, fontSize: 11, tickLine: false, axisLine: false } as const;
const H = ({ h = 230, label, children }: { h?: number; label?: string; children: any }) => (
  <div style={{ height: h }} className="mt-3" role="img" aria-label={label}>
    <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
  </div>
);

/** Aire de tendance (ex. facturation mensuelle). data: [{name, v}] */
export function AreaTrend({ data, color = T.emerald, name = "Valeur", h }: { data: any[]; color?: string; name?: string; h?: number }) {
  const id = "g" + color.replace("#", "");
  return (
    <H h={h}>
      <AreaChart data={data} margin={{ left: -8, right: 8, top: 6 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={T.line} vertical={false} />
        <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey="v" name={name} stroke={color} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </H>
  );
}

/** Donut par BU. data: [{name, value}] — légende visible (lisible au tactile, sans survol). */
export function DonutBU({ data, h = 230 }: { data: any[]; h?: number }) {
  const total = data.reduce((s, d) => s + (d.value || 0), 0) || 1;
  return (
    <H h={h} label={"Répartition par BU : " + data.map((d) => `${d.name} ${Math.round((d.value / total) * 100)}%`).join(", ")}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2}>
          {data.map((e, i) => <Cell key={i} fill={BU_COL[e.name] || T.faint} stroke="none" />)}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
        <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={9} wrapperStyle={legendStyle}
          formatter={(name: string) => { const d = data.find((x) => x.name === name); return `${name} · ${Math.round(((d?.value || 0) / total) * 100)}%`; }} />
      </PieChart>
    </H>
  );
}

/** Barres simples. data: [{name, v}] */
export function Bars({ data, color = T.clay, name = "Valeur", h = 200, size = 34 }: { data: any[]; color?: string; name?: string; h?: number; size?: number }) {
  return (
    <H h={h}>
      <BarChart data={data} margin={{ left: -8, right: 8 }}>
        <CartesianGrid stroke={T.line} vertical={false} />
        <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={12} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip cursor={{ fill: T.panel2 }} content={<ChartTooltip />} />
        <Bar dataKey="v" name={name} fill={color} radius={[4, 4, 0, 0]} barSize={size} />
      </BarChart>
    </H>
  );
}

/** Barres groupées. data + series:[{key,color,name}] */
export function GroupedBars({ data, series, h = 230, size = 22 }: { data: any[]; series: { key: string; color: string; name: string }[]; h?: number; size?: number }) {
  return (
    <H h={h}>
      <BarChart data={data} margin={{ left: -6, right: 8 }}>
        <CartesianGrid stroke={T.line} vertical={false} />
        <XAxis dataKey="name" {...axis} interval="preserveStartEnd" minTickGap={12} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip cursor={{ fill: T.panel2 }} content={<ChartTooltip />} />
        <Legend verticalAlign="top" height={24} iconType="square" iconSize={10} wrapperStyle={legendStyle} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} barSize={size} />)}
      </BarChart>
    </H>
  );
}

/** Jauge radiale (0..1) — probabilité d'atteinte. */
export function Gauge({ value, color = T.gold, h = 200 }: { value: number; color?: string; h?: number }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const data = [{ name: "v", value: Math.round(v * 100), fill: color }];
  return (
    <div style={{ height: h }} className="mt-3 relative">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={220} endAngle={-40}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: T.panel2 }} dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="font-display text-3xl tabnum" style={{ color }}>{Math.round(v * 100)}%</div>
      </div>
    </div>
  );
}
