"use client";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculateMA } from "@/lib/indicators/movingAverage";
import type { StockDailyBar } from "@/lib/types/stock";

interface Props {
  bars: StockDailyBar[];
  /** Optional support/resistance lines drawn as flat references. */
  support?: number;
  resistance?: number;
}

/**
 * v1: line+bar hybrid (not a true candlestick). Shows close vs MAs and
 * a coloured pct-change bar. Sufficient for spotting trend/pullback shape.
 */
export function KLineChart({ bars, support, resistance }: Props) {
  if (bars.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-subtle">
        No data
      </div>
    );
  }
  const closes = bars.map((b) => b.close);
  const ma5 = calculateMA(closes, 5);
  const ma10 = calculateMA(closes, 10);
  const ma20 = calculateMA(closes, 20);
  const ma30 = calculateMA(closes, 30);
  const data = bars.map((b, i) => ({
    date: b.date.slice(5),
    close: b.close,
    ma5: isNaN(ma5[i]) ? null : +ma5[i].toFixed(2),
    ma10: isNaN(ma10[i]) ? null : +ma10[i].toFixed(2),
    ma20: isNaN(ma20[i]) ? null : +ma20[i].toFixed(2),
    ma30: isNaN(ma30[i]) ? null : +ma30[i].toFixed(2),
    pct: b.pctChange,
    turnover: b.turnoverRate,
  }));

  const minClose = Math.min(...closes) * 0.95;
  const maxClose = Math.max(...closes) * 1.05;

  return (
    <div className="space-y-2">
      <div className="h-64">
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" stroke="#6b7280" fontSize={11} interval={Math.ceil(data.length / 12)} />
            <YAxis stroke="#6b7280" fontSize={11} domain={[minClose, maxClose]} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #1f2937" }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Line type="monotone" dataKey="close" stroke="#e5e7eb" dot={false} strokeWidth={1.5} name="收盘" />
            <Line type="monotone" dataKey="ma5" stroke="#60a5fa" dot={false} strokeWidth={1} name="MA5" />
            <Line type="monotone" dataKey="ma10" stroke="#f59e0b" dot={false} strokeWidth={1} name="MA10" />
            <Line type="monotone" dataKey="ma20" stroke="#a78bfa" dot={false} strokeWidth={1} name="MA20" />
            <Line type="monotone" dataKey="ma30" stroke="#34d399" dot={false} strokeWidth={1} name="MA30" />
            {support !== undefined && (
              <Line
                type="monotone"
                dataKey={() => support}
                stroke="#10b981"
                strokeDasharray="4 4"
                dot={false}
                name="支撑"
                isAnimationActive={false}
              />
            )}
            {resistance !== undefined && (
              <Line
                type="monotone"
                dataKey={() => resistance}
                stroke="#ef4444"
                strokeDasharray="4 4"
                dot={false}
                name="压力"
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-24">
        <ResponsiveContainer>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" stroke="#6b7280" fontSize={10} hide />
            <YAxis stroke="#6b7280" fontSize={10} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #1f2937" }}
            />
            <Bar dataKey="turnover" fill="#3b82f6" name="换手率" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
