// Graphes Recharts thématisés Forest & Gold (mirroir du prototype).
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, AreaChart, Area, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { T, BU_COL, fmt, fmtFull } from "./tokens";

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

const axis = { stroke: T.faint, fontSize: 11, tickLine: false, axisLine: false } as const;
const H = ({ h = 230, children }: { h?: number; children: any }) => (
  <div style={{ height: h }} className="mt-3">
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
        <XAxis dataKey="name" {...axis} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip content={<ChartTooltip />} />
        <Area type="monotone" dataKey="v" name={name} stroke={color} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </H>
  );
}

/** Donut par BU. data: [{name, value}] */
export function DonutBU({ data, h = 230 }: { data: any[]; h?: number }) {
  return (
    <H h={h}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2}>
          {data.map((e, i) => <Cell key={i} fill={BU_COL[e.name] || T.faint} stroke="none" />)}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
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
        <XAxis dataKey="name" {...axis} />
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
        <XAxis dataKey="name" {...axis} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip cursor={{ fill: T.panel2 }} content={<ChartTooltip />} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} barSize={size} />)}
      </BarChart>
    </H>
  );
}

/** Composé : barres réalisé/projeté + ligne. (prévision) */
export function Composed({ data, h = 300 }: { data: any[]; h?: number }) {
  return (
    <H h={h}>
      <ComposedChart data={data} margin={{ left: -6, right: 8, top: 6 }}>
        <CartesianGrid stroke={T.line} vertical={false} />
        <XAxis dataKey="name" {...axis} />
        <YAxis {...axis} tickFormatter={fmt} width={44} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="actual" name="Réalisé" fill={T.emerald} radius={[3, 3, 0, 0]} barSize={16} />
        <Bar dataKey="forecast" name="Projeté" fill={T.gold} radius={[3, 3, 0, 0]} barSize={16} />
        <Line type="monotone" dataKey="reste" name="Reste" stroke={T.clay} strokeWidth={2} dot={false} />
      </ComposedChart>
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
