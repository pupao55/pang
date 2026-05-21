// Smoke test for /validation page — confirms the v1.9 HorizonVerdictCard
// is invoked when horizon data is present. Per T-004's acceptance
// criteria, this is a pure import/source-level assertion: no React
// rendering, no network, no data adapter execution. The goal is to
// catch the case where someone deletes or renames the card and the
// page silently stops surfacing the horizon verdict.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_PATH = join(process.cwd(), "src/app/validation/page.tsx");
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

describe("/validation page smoke", () => {
  it("imports the horizon calibration engine", () => {
    expect(PAGE_SOURCE).toMatch(
      /from\s+["']@\/lib\/engine\/horizonCalibration["']/,
    );
    expect(PAGE_SOURCE).toContain("calibrateHorizons");
  });

  it("defines a HorizonVerdictCard component", () => {
    expect(PAGE_SOURCE).toMatch(/function\s+HorizonVerdictCard\s*\(/);
  });

  it("conditionally renders HorizonVerdictCard when horizon data exists", () => {
    // The check is `{horizon && <HorizonVerdictCard horizon={horizon} />}`.
    // We assert the conditional + the prop shape so a refactor that
    // accidentally always-renders or drops the prop is caught.
    expect(PAGE_SOURCE).toMatch(
      /\{\s*horizon\s*&&\s*<HorizonVerdictCard\s+horizon=\{horizon\}\s*\/>\s*\}/,
    );
  });

  it("links to the v1.9 horizon-calibration report", () => {
    expect(PAGE_SOURCE).toContain("horizon-calibration-report.md");
    expect(PAGE_SOURCE).toContain("npm run calibrate:horizons");
  });

  it("ValidationPage is the default export and is async (server component)", () => {
    // We grep the signature rather than evaluate the module — importing
    // a Next.js server component into vitest's node env would resolve
    // the data adapters at module-load and is brittle.
    expect(PAGE_SOURCE).toMatch(
      /export\s+default\s+async\s+function\s+ValidationPage\s*\(/,
    );
  });

  it("page declares dynamic = 'force-dynamic' so it always reads live state", () => {
    expect(PAGE_SOURCE).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });
});
