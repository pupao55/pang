// Per-strategy calibration — run the v1.3 calibration + risk-filter + threshold
// sweep separately for each strategy. v1.3's global calibration is too coarse
// when one strategy is well-tuned and another is not (the global verdict mixes
// them). Per-strategy verdicts give the recommendation engine the resolution
// it needs.

import {
  calibrateScores,
  type CalibrationVerdict,
  type ScoreCalibrationResult,
  type ForwardReturnResolver,
  type HistoricalSignalRecord,
} from "./scoreCalibration";
import {
  validateRiskFilter,
  type RiskFilterValidationResult,
  type RiskFilterVerdict,
} from "./riskFilterValidation";
import {
  runThresholdSweep,
  type SweepResult,
} from "./thresholdSweep";
import {
  evaluateStrategyQuality,
  type StrategyQualityRow,
  type StrategyRecommendation,
} from "./strategyQuality";

export interface PerStrategyCalibrationRow {
  strategyId: string;
  signalCount: number;
  quality: StrategyQualityRow;
  calibration: ScoreCalibrationResult;
  calibrationVerdict: CalibrationVerdict;
  riskValidation: RiskFilterValidationResult;
  riskVerdict: RiskFilterVerdict;
  sweep: SweepResult;
  /** Aggregate verdict — combines quality + calibration. */
  overall: StrategyRecommendation;
}

export function buildPerStrategyCalibration(
  signals: HistoricalSignalRecord[],
  resolver: ForwardReturnResolver,
): PerStrategyCalibrationRow[] {
  const grouped = new Map<string, HistoricalSignalRecord[]>();
  for (const s of signals) {
    (grouped.get(s.strategyId) ?? grouped.set(s.strategyId, []).get(s.strategyId)!).push(s);
  }
  const out: PerStrategyCalibrationRow[] = [];
  for (const [strategyId, list] of grouped) {
    const calibration = calibrateScores(list, resolver);
    const quality = evaluateStrategyQuality({
      signals: list,
      resolver,
      scoreCalibrationOk: calibration.verdict !== "NOT_CALIBRATED",
    })[0];
    const riskValidation = validateRiskFilter(list, resolver);
    const sweep = runThresholdSweep(list, resolver);
    out.push({
      strategyId,
      signalCount: list.length,
      quality,
      calibration,
      calibrationVerdict: calibration.verdict,
      riskValidation,
      riskVerdict: riskValidation.verdict,
      sweep,
      overall: quality.recommendation,
    });
  }
  out.sort((a, b) => b.signalCount - a.signalCount);
  return out;
}
