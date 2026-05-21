#!/usr/bin/env node
// check-agent-workspace.mjs — verify that the agentic operating files exist.
//
// Run with: `npm run check:agent-workspace`.
//
// Exits 0 if all required files are present, 1 otherwise. Intentionally
// minimal: it does not validate the *content* of the files, only their
// presence. Content drift is caught by code review and by the agents
// themselves reading the files.

import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED = [
  "CLAUDE.md",
  "SPEC.md",
  "TASKS.md",
  "DECISIONS.md",
  "HANDOFF.md",
  "RESEARCH_LOG.md",
  "BUGS.md",
  ".claude/agents/product-strategist.md",
  ".claude/agents/researcher.md",
  ".claude/agents/frontend-engineer.md",
  ".claude/agents/backend-engineer.md",
  ".claude/agents/qa-reviewer.md",
  ".claude/agents/growth-strategist.md",
];

const OPTIONAL = [
  "docs/architecture.md",
  "docs/product.md",
  "docs/launch.md",
  "docs/data-policy.md",
  "docs/agent-council.md",
  "docs/approval-policy.md",
  "scripts/check-data-policy.mjs",
  "scripts/agent_council.mjs",
  "reports/agent-council/template.md",
  "NEXT_ACTION.md",
];

const missing = [];
const present = [];

for (const rel of REQUIRED) {
  if (existsSync(join(ROOT, rel))) present.push(rel);
  else missing.push(rel);
}

const optionalMissing = [];
for (const rel of OPTIONAL) {
  if (!existsSync(join(ROOT, rel))) optionalMissing.push(rel);
}

console.log(`Pangzi agent-workspace check — root=${relative(process.cwd(), ROOT) || "."}`);
console.log(`  required present: ${present.length}/${REQUIRED.length}`);
if (missing.length > 0) {
  console.log(`  required MISSING:`);
  for (const m of missing) console.log(`    - ${m}`);
}
if (optionalMissing.length > 0) {
  console.log(`  optional missing (informational only):`);
  for (const m of optionalMissing) console.log(`    - ${m}`);
}

if (missing.length > 0) {
  console.error(
    `\nFAIL — ${missing.length} required file(s) missing. ` +
      `Read CLAUDE.md for the agentic workspace contract.`,
  );
  process.exit(1);
}
console.log(`\nOK — all required ops files exist.`);
process.exit(0);
