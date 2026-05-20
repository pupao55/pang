// Signal types — output of strategies and the scoring engine.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "FORBIDDEN";

export type SignalType =
  | "BREAKOUT"
  | "PULLBACK"
  | "REVERSAL"
  | "SECOND_BUY"
  | "WATCH_ONLY";

export type SuggestedAction =
  | "WATCH"
  | "LIGHT_POSITION"
  | "STANDARD_POSITION"
  | "AVOID";

export interface StockSignal {
  symbol: string;
  name: string;
  date: string;
  strategyId: string;
  strategyName: string;
  score: number;
  technicalScore: number;
  sectorScore: number;
  sentimentScore: number;
  liquidityScore: number;
  fundamentalSafetyScore: number;
  riskPenalty: number;
  riskLevel: RiskLevel;
  signalType: SignalType;
  suggestedAction: SuggestedAction;
  keySupport: number;
  keyResistance: number;
  stopLoss: number;
  target1: number;
  target2: number;
  /** Human-readable bullet points. May contain Chinese trading terms. */
  explanation: string[];
  bullishFactors: string[];
  bearishFactors: string[];
  risks: string[];
  /**
   * Other strategy ids that also fired for this stock on the same date.
   * Helpful as a corroboration signal in the UI and downstream analysis.
   */
  corroboratingStrategies?: string[];
}
