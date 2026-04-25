"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = {
  low: "#10B981",
  medium: "#F59E0B",
  high: "#F43F5E",
};

export function RiskDonut({ low, medium, high }: { low: number; medium: number; high: number }) {
  const total = low + medium + high;
  const data = [
    { name: "Low risk", value: low, key: "low" },
    { name: "Medium risk", value: medium, key: "medium" },
    { name: "High risk", value: high, key: "high" },
  ];

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={42}
              outerRadius={62}
              paddingAngle={total ? 2 : 0}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.key} fill={COLORS[d.key as keyof typeof COLORS]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #E2E8F0",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-2xl font-semibold tracking-tight">{total}</div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">deals</div>
          </div>
        </div>
      </div>

      <ul className="flex-1 space-y-2 text-sm">
        {data.map((d) => {
          const pct = total ? (d.value / total) * 100 : 0;
          return (
            <li key={d.key} className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: COLORS[d.key as keyof typeof COLORS] }}
              />
              <span className="flex-1">{d.name}</span>
              <span className="font-mono tabular-nums text-ink-700">
                {d.value} <span className="text-ink-400">({pct.toFixed(0)}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
