"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface TrendPoint {
  date: string;
  score: number;
}

// Dark-surface chart tokens (validated against card navy #182136):
// line #0284C7 passes lightness band + ≥3:1 contrast; grid/axes recessive.
const GRID = "#263352";
const AXIS = "#64749B";
const LINE = "#0284C7";
const DOT_RING = "#182136";

export function ScoreTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #35446C",
              background: "#1C2742",
              color: "#F2F6FC",
              fontSize: 12,
            }}
            labelStyle={{ color: "#93A3C6" }}
            itemStyle={{ color: "#F2F6FC" }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke={LINE}
            strokeWidth={2}
            dot={{ r: 3, fill: LINE, stroke: DOT_RING, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "#38BDF8", stroke: DOT_RING, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
