import { BacktestForm } from "./BacktestForm";

export default function BacktestPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold text-ink tracking-tight">策略回测 / Backtest</h1>
        <p className="text-sm text-muted mt-1">
          MVP 假设: 等权资金、无手续费与滑点、按收盘或次开盘成交。仅用于策略形态有效性研究。
          {" "}
          <span className="opacity-70">(See backtestEngine.ts for TODOs in v2.)</span>
        </p>
      </div>
      <BacktestForm />
    </div>
  );
}
