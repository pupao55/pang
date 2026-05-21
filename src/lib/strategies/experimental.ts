// experimental.ts — research-only strategy registry, gated behind an env var.
//
// Lives outside `STRATEGY_LIST` (the production default in `./index.ts`)
// so that `/signals`, `/backtest`, `/validation`, and any other code that
// iterates the default registry never sees experimental strategies.
//
// CLI / research scripts that want to include experimental strategies must
// either (a) import an entry from `EXPERIMENTAL_STRATEGIES` directly, or
// (b) check `experimentalStrategiesEnabled()` first.

import { firstBreakoutRelaxedStrategy } from "./firstBreakoutRelaxedStrategy";
import type { StrategyDefinition } from "./index";

function def(
  id: string,
  nameCN: string,
  nameEN: string,
  fn: StrategyDefinition["fn"],
): StrategyDefinition {
  return { id, nameCN, nameEN, name: `${nameCN} / ${nameEN}`, fn };
}

export const EXPERIMENTAL_STRATEGY_LIST: StrategyDefinition[] = [
  def(
    "firstBreakoutRelaxed",
    "低位首爆放宽版",
    "First Breakout Relaxed",
    firstBreakoutRelaxedStrategy,
  ),
];

export const EXPERIMENTAL_STRATEGIES: Record<string, StrategyDefinition> =
  Object.fromEntries(EXPERIMENTAL_STRATEGY_LIST.map((d) => [d.id, d]));

/**
 * Opt-in flag for any caller that wants to merge experimentals into the
 * production registry. Default: false. Reads `ENABLE_EXPERIMENTAL_STRATEGIES`
 * from the environment.
 *
 * The current production code does **not** call this — experimentals are
 * exposed only to the dedicated experiment script. The helper exists so a
 * future research CLI can flip the switch without touching strategy code.
 */
export function experimentalStrategiesEnabled(): boolean {
  const v = (
    process.env.ENABLE_EXPERIMENTAL_STRATEGIES ?? ""
  ).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
