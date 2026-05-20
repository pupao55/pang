"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "@/lib/types/backtest";

export function BacktestResultChart({ equityCurve }: { equityCurve: EquityPoint[] }) {
  if (equityCurve.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-subtle">
        No trades produced — try a wider date range or another strategy.
      </div>
    );
  }
  const data = equityCurve.map((p) => ({ date: p.date.slice(5), equity: p.equity }));
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
          <YAxis stroke="#6b7280" fontSize={11} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #1f2937" }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Line
            type="monotone"
            dataKey="equity"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            name="Equity"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
