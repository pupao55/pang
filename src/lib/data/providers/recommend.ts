// Pure provider-recommendation logic used by the campaign CLI + tests.
//
// Inputs are health snapshots derived from each provider's local cache /
// status files. Output is the single recommended next command.

export interface ProviderSnapshot {
  providerId: "akshareLocal" | "baostockLocal";
  cacheOk: boolean;
  symbolCount: number;
  succeeded: number;
  failed: number;
  empty: number;
  skipped: number;
  lastUpdatedAt?: string;
}

export interface ProviderRecommendation {
  provider: "akshareLocal" | "baostockLocal";
  rationale: string;
  command: string;
}

export function recommendProvider(
  akshare: ProviderSnapshot,
  baostock: ProviderSnapshot,
): ProviderRecommendation {
  const akshareBlocked = !akshare.cacheOk || akshare.failed >= 3 || akshare.symbolCount < 5;
  const baostockHealthy = baostock.cacheOk && baostock.symbolCount >= 5;

  if (akshareBlocked && !baostock.cacheOk) {
    return {
      provider: "baostockLocal",
      rationale:
        "AkShare cache is sparse or blocked, and BaoStock has no cache yet. " +
        "BaoStock uses its own upstream and is not affected by Eastmoney IP blocks.",
      command:
        "npm run setup:baostock && npm run fetch:baostock:sample && npm run check:data:baostock",
    };
  }
  if (akshareBlocked && baostockHealthy && baostock.symbolCount < 30) {
    return {
      provider: "baostockLocal",
      rationale:
        "AkShare is blocked; BaoStock works but the universe is still small. " +
        "Grow BaoStock toward 30+ symbols for EARLY_RESEARCH readiness.",
      command: "npm run fetch:baostock:resume && npm run check:maturity:baostock",
    };
  }
  if (akshareBlocked && baostockHealthy && baostock.symbolCount >= 30) {
    return {
      provider: "baostockLocal",
      rationale:
        "BaoStock universe is large enough for EARLY_RESEARCH. Build context and calibrate.",
      command:
        "npm run build:sentiment -- --source baostockLocal && npm run validate:baostock",
    };
  }
  if (!akshareBlocked && akshare.symbolCount < 30) {
    return {
      provider: "akshareLocal",
      rationale: "AkShare cache is growing; continue the slow resume campaign.",
      command: "npm run fetch:akshare:resume && npm run check:maturity",
    };
  }
  return {
    provider: "akshareLocal",
    rationale: "AkShare cache looks healthy; refresh context and calibrate.",
    command: "npm run refresh:akshare-context && npm run calibrate:strategies",
  };
}
