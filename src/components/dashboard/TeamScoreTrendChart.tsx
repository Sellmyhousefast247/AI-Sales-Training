"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

export interface TrendPoint {
  date: string;
  score: number;
  calls: number;
}

export function TeamScoreTrendChart({ data, target = 7.5 }: { data: TrendPoint[]; target?: number }) {
  const labelled = data.map((p) => ({
    ...p,
    label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={labelled} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={{ stroke: "#CBD5E1" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            domain={[0, 10]}
            tick={{ fontSize: 11, fill: "#64748B" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #E2E8F0",
              boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
              fontSize: 12,
            }}
            formatter={(value: number, key) => {
              if (key === "score") return [Number(value).toFixed(2), "Avg score"];
              return [value, key];
            }}
            labelFormatter={(l) => `${l}`}
          />
          <ReferenceLine
            y={target}
            stroke="#94A3B8"
            strokeDasharray="4 4"
            label={{ value: `target ${target}`, position: "right", fill: "#94A3B8", fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke="#10B981"
            strokeWidth={2}
            fill="url(#scoreGrad)"
            dot={false}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
