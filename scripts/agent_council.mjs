#!/usr/bin/env node
// agent_council.mjs — deterministic agent-council planner (v1).
//
// See docs/agent-council.md for the protocol. This script:
//   1. parses TASKS.md + BUGS.md + HANDOFF.md
//   2. filters to ready, unblocked tasks
//   3. classifies each task's risk (docs-only … destructive)
//   4. scores each task with the rubric
//   5. picks the top task
//   6. writes reports/agent-council/<ts>.md + latest.md + NEXT_ACTION.md
//
// It does NOT call any external API and does NOT execute the selected
// task. Even with --execute-safe it only records that execution would
// have been permitted (planner-only in v1).
//
// All helpers are exported as named exports so the vitest suite can
// drive them with synthetic inputs. The script body runs only when
// invoked directly (CLI mode).

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a TASKS.md-style document into structured tasks.
 *
 * Each task starts with a heading like:
 *   ## T-NNN: title
 * followed by `Status: ...`, `Owner: ...`, `Priority: ...`, `Depends on: ...`,
 * `Files: ...`, `Goal: ...`, optional `Notes:` etc.
 *
 * Status values are normalised to one of:
 *   "ready" | "in_progress" | "blocked" | "done"
 * Anything else maps to "ready" (lenient).
 */
export function parseTasks(md) {
  const tasks = [];
  if (!md) return tasks;
  // Split on `## T-` headings; keep the heading with its body.
  const blocks = md.split(/\n(?=## T-)/g);
  for (const block of blocks) {
    const m = block.match(/^## (T-[A-Z0-9-]+):\s*(.+)$/m);
    if (!m) continue;
    const id = m[1].trim();
    const title = m[2].trim();
    const status = pickField(block, "Status") ?? "ready";
    const owner = pickField(block, "Owner") ?? "unknown";
    const priority = pickField(block, "Priority") ?? "P2";
    const dependsOnRaw = pickField(block, "Depends on") ?? "none";
    const filesRaw = pickField(block, "Files") ?? "";
    const goal = pickField(block, "Goal") ?? "";
    const dependsOn = dependsOnRaw
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter((x) => x && x !== "none" && x !== "-");
    const files = filesRaw
      .split(/[,`]/g)
      .map((x) => x.replace(/[`*]/g, "").trim())
      .filter(Boolean);
    tasks.push({
      id,
      title,
      status: normaliseStatus(status),
      owner: owner.toLowerCase().split(" ")[0],
      priority: priority.toUpperCase(),
      dependsOn,
      files,
      goal,
      body: block,
    });
  }
  return tasks;
}

function pickField(block, name) {
  // Match `Field: value` until end of line.
  const re = new RegExp(`^${name}:\\s*(.*)$`, "mi");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function normaliseStatus(s) {
  const x = s.toLowerCase();
  if (x.startsWith("done")) return "done";
  if (x.startsWith("in_progress") || x.startsWith("in progress")) return "in_progress";
  if (x.startsWith("blocked")) return "blocked";
  return "ready";
}

/**
 * Parse a BUGS.md-style document. Returns the count of open vs resolved
 * bugs plus a list of `B-NNN: title` entries flagged "open".
 */
export function parseBugs(md) {
  const bugs = [];
  if (!md) return { open: 0, resolved: 0, items: [] };
  const blocks = md.split(/\n(?=### B-)/g);
  let open = 0;
  let resolved = 0;
  for (const block of blocks) {
    const m = block.match(/^### (B-[A-Z0-9-]+):\s*(.+)$/m);
    if (!m) continue;
    const status = (pickField(block, "Status") ?? "open").toLowerCase();
    if (status.includes("fixed") || status.includes("wontfix") || status.includes("resolved")) {
      resolved++;
    } else {
      open++;
    }
    bugs.push({
      id: m[1].trim(),
      title: m[2].trim(),
      status,
      severity: (pickField(block, "Severity") ?? "minor").toLowerCase(),
    });
  }
  return { open, resolved, items: bugs };
}

/**
 * Pull the most recent session log entry from HANDOFF.md so the council
 * can show what just happened.
 */
export function parseLatestHandoff(md) {
  if (!md) return { date: null, title: null };
  const m = md.match(/^###\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+)$/m);
  if (!m) return { date: null, title: null };
  return { date: m[1], title: m[2].trim() };
}

// ─────────────────────────────────────────────────────────────────────
// Risk classification + scoring
// ─────────────────────────────────────────────────────────────────────

/**
 * Risk classes (lowest to highest):
 *   docs-only         → no production code touched.
 *   ui-only           → only src/app/ + src/components/ files.
 *   backend           → src/lib/engine/ src/lib/store/ scripts/ etc.
 *   strategy-scoring  → src/lib/strategies/ + src/lib/config/constants.ts + src/lib/engine/scoreEngine.ts + riskFilter.ts
 *   destructive       → git rm/filter-repo/force-push/file deletion.
 */
export function classifyRisk(task) {
  const blob = `${task.title} ${task.goal} ${task.files.join(" ")} ${task.body}`.toLowerCase();

  // Destructive first — beats everything.
  if (
    /git filter-repo|git rm --cached|git rm -r|git reset --hard|git push --force|--force-with-lease|history rewrite|destructive/.test(blob)
  ) {
    return "destructive";
  }
  // Strategy / scoring / risk-filter / data adapter.
  if (
    /src\/lib\/strategies\/|src\/lib\/config\/constants|scoreengine|score engine|riskfilter|risk filter|src\/lib\/data\/adapters\//.test(
      blob,
    )
  ) {
    return "strategy-scoring";
  }
  // Backend / engine / data scripts.
  if (
    /src\/lib\/engine\/|src\/lib\/store\/|src\/lib\/reports\/|scripts\/.+\.ts|\.gitignore|package\.json/.test(
      blob,
    )
  ) {
    return "backend";
  }
  // UI.
  if (/src\/app\/|src\/components\/|tailwind|globals\.css/.test(blob)) {
    return "ui-only";
  }
  // Default: docs-only.
  return "docs-only";
}

export const RISK_PENALTY = {
  "docs-only": 0,
  "ui-only": 2,
  backend: 4,
  "strategy-scoring": 6,
  destructive: 10,
};

export const SAFE_AUTO_RISK = new Set(["docs-only"]);
export const APPROVAL_REQUIRED_RISK = new Set([
  "strategy-scoring",
  "destructive",
]);

/**
 * Score a task on the rubric. Heuristic, but deterministic — same
 * inputs always produce the same numbers.
 */
export function scoreTask(task, allTasks = []) {
  const blob = `${task.title} ${task.goal} ${task.body}`.toLowerCase();

  // Base rubric values
  let userValue = 3;
  let researchValue = 3;
  let riskReduction = 3;
  let reversibility = 4;
  let implementationCost = 2;
  let dependencyClearing = 3;
  let demoValue = 1;

  // Priority bumps userValue + researchValue.
  if (task.priority === "P0") {
    userValue += 2;
    researchValue += 1;
  } else if (task.priority === "P1") {
    userValue += 1;
  } else if (task.priority === "P2") {
    userValue -= 1;
  }

  // Keyword bumps
  if (/\b(\/signals|\/dashboard|\/validation|landing|ui|copy)\b/.test(blob)) {
    userValue += 1;
    demoValue += 2;
  }
  if (/\b(experiment|calibrat|validat|sweep|horizon)\b/.test(blob)) {
    researchValue += 2;
  }
  if (/\b(audit|policy|guard|contract|pre-?commit|ci|ops)\b/.test(blob)) {
    riskReduction += 2;
  }
  if (/\b(remove|delete|untrack|rm|filter-repo)\b/.test(blob)) {
    reversibility -= 2;
  }
  if (/\b(rewrite|refactor|migrat)\b/.test(blob)) {
    implementationCost += 2;
  }
  if (/\b(docs?|readme|spec|handoff|log|markdown|report)\b/.test(blob)) {
    implementationCost -= 1;
  }

  // dependencyClearing = how many other tasks depend on this one
  if (allTasks.length > 0) {
    const dependents = allTasks.filter((t) => t.dependsOn.includes(task.id)).length;
    dependencyClearing = Math.min(5, 2 + dependents);
  }

  // Clamp 1..5 for the rubric inputs (except cost which can be 1..5 too).
  const clamp = (v, lo = 1, hi = 5) => Math.max(lo, Math.min(hi, v));
  userValue = clamp(userValue);
  researchValue = clamp(researchValue);
  riskReduction = clamp(riskReduction);
  reversibility = clamp(reversibility);
  implementationCost = clamp(implementationCost);
  dependencyClearing = clamp(dependencyClearing);
  demoValue = clamp(demoValue);

  const risk = classifyRisk(task);
  const riskPenalty = RISK_PENALTY[risk];

  const priorityScore =
    userValue * 2 +
    researchValue * 2 +
    riskReduction * 1.5 +
    dependencyClearing * 1.5 +
    demoValue +
    reversibility -
    implementationCost -
    riskPenalty;

  return {
    task,
    risk,
    riskPenalty,
    rubric: {
      userValue,
      researchValue,
      riskReduction,
      reversibility,
      implementationCost,
      dependencyClearing,
      demoValue,
    },
    priorityScore: +priorityScore.toFixed(2),
  };
}

/**
 * Returns true if the task's risk class requires explicit user approval
 * before execution.
 */
export function approvalRequired(risk) {
  return APPROVAL_REQUIRED_RISK.has(risk);
}

/**
 * Returns the candidate list: tasks that are `ready` AND whose
 * dependsOn set is satisfied (either empty or every dep is `done`).
 */
const TASK_ID_RE = /^[TB]-[A-Z0-9-]+$/;
/**
 * Standing / heartbeat tasks (e.g. `T-AGENT-001 — Run the agent council`)
 * are not real work — they describe the loop itself. Excluding them from
 * candidate selection prevents the council from recommending itself,
 * which is both a meta-loop and useless.
 */
const META_TASK_PREFIX = /^T-(AGENT|META)-/;

export function selectCandidates(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => {
    if (t.status !== "ready") return false;
    if (META_TASK_PREFIX.test(t.id)) return false;
    for (const dep of t.dependsOn) {
      // Free-form deps (e.g. "explicit user approval") that do not look
      // like a task id are treated as informational, not blocking.
      if (!TASK_ID_RE.test(dep)) continue;
      const d = byId.get(dep);
      // A task-id-shaped dep that is unknown or not done → block.
      if (!d || d.status !== "done") return false;
    }
    return true;
  });
}

/**
 * Pick the top-scoring candidate. Ties: lower riskPenalty wins; then
 * lower id (compared as a string with numeric sort on trailing digits).
 */
export function pickTop(scored) {
  const sorted = [...scored].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.riskPenalty !== b.riskPenalty) return a.riskPenalty - b.riskPenalty;
    const ai = parseInt(a.task.id.replace(/\D+/g, ""), 10) || 0;
    const bi = parseInt(b.task.id.replace(/\D+/g, ""), 10) || 0;
    return ai - bi;
  });
  return sorted[0];
}

// ─────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────

function rubricRow(s) {
  const r = s.rubric;
  return `| ${s.task.id} | ${r.userValue} | ${r.researchValue} | ${r.riskReduction} | ${r.reversibility} | ${r.implementationCost} | ${r.dependencyClearing} | ${r.demoValue} | ${s.riskPenalty} | ${s.priorityScore.toFixed(2)} |`;
}

function rolePicks(top) {
  const why = `${top.task.id} ${top.task.title}`;
  return [
    { role: "Product Strategist", pick: top.task.id, why: "highest composite priority score" },
    { role: "Researcher", pick: top.task.id, why: "highest researchValue weight in rubric" },
    { role: "Backend Engineer", pick: top.task.id, why: `risk class ${top.risk}, implementationCost ${top.rubric.implementationCost}` },
    { role: "Frontend Engineer", pick: top.task.id, why: top.risk === "ui-only" ? "UI lane" : "no UI impact" },
    { role: "QA Reviewer", pick: top.task.id, why: `risk class ${top.risk}, riskReduction ${top.rubric.riskReduction}` },
    { role: "Growth Strategist", pick: top.task.id, why: `demoValue ${top.rubric.demoValue}` },
  ];
}

export function renderCouncilReport({ date, repoState, candidates, scored, top, handoff, bugs }) {
  const candRows = candidates
    .map((t) => `| ${t.id} | ${t.title} | ${t.owner} | ${t.priority} | ${classifyRisk(t)} | ${t.files.join(", ") || "—"} |`)
    .join("\n");
  const scoreRows = scored.map(rubricRow).join("\n");
  const roleRows = rolePicks(top)
    .map((r) => `| ${r.role} | ${r.pick} | ${r.why} |`)
    .join("\n");
  const approval = approvalRequired(top.risk);
  const objections = scored
    .filter((s) => approvalRequired(s.risk) && s.task.id !== top.task.id)
    .slice(0, 4)
    .map((s) => `- ${s.task.id} requires approval (risk: ${s.risk}); defer until human signs off.`)
    .join("\n");

  return `# Agent council report

> Date: ${date}
> Generated by: \`scripts/agent_council.mjs\`

## Inputs read

- \`TASKS.md\` — ${repoState.ready} ready · ${repoState.inProgress} in_progress · ${repoState.done} done · ${repoState.blocked} blocked
- \`BUGS.md\` — open: ${bugs.open} · resolved: ${bugs.resolved}
- \`HANDOFF.md\` — last entry: ${handoff.date ?? "—"} — ${handoff.title ?? "—"}
- \`DECISIONS.md\`, \`RESEARCH_LOG.md\`, \`AUDIT.md\`, \`reports/\` — scanned where present.

## Current repo state

- Working tree: not inspected by this script (run \`git status\` to check).
- Tests / typecheck / data-policy / ops-contract: not run by the council.
  Run the verification commands below before executing the chosen task.

## Candidate tasks (ready & unblocked)

| Id | Title | Owner | Priority | Risk class | Files |
|---|---|---|---|---|---|
${candRows || "| _none_ | | | | | |"}

## Agent proposals

| Role | Pick | Why |
|---|---|---|
${roleRows}

## Agent objections

${objections || "_none_"}

## Debate summary

The composite score is dominated by ${top.task.id}: userValue ${top.rubric.userValue}, researchValue ${top.rubric.researchValue}, riskReduction ${top.rubric.riskReduction}, and ${top.risk === "docs-only" ? "zero risk penalty (docs-only)" : `risk penalty ${top.riskPenalty} (${top.risk})`}. ${approval ? "Approval is required before execution." : "Execution is safe to proceed once verification passes."}

## Scoring table

| Task | userValue | researchValue | riskReduction | reversibility | implCost | depClearing | demoValue | riskPenalty | TOTAL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${scoreRows}

## Selected next action

- **Task**: ${top.task.id} — ${top.task.title}
- **Why**: top of composite rubric (${top.priorityScore.toFixed(2)})
- **Approval requirement**: ${approval ? "REQUIRED" : "not required"}
- **Risk class**: ${top.risk}

## Execution plan

1. Read the task body in \`TASKS.md\` (id ${top.task.id}).
2. ${approval ? "Surface this plan to the user and wait for explicit approval." : "Proceed under the verification plan below."}
3. Touch only the files listed in the task's \`Files:\` field.

## Verification plan

\`\`\`
npm test
npm run typecheck
npm run check:data-policy
npm run check:agent-workspace
\`\`\`

Plus any task-specific check listed in \`TASKS.md\`.

## Stop conditions

- If a verification command fails, stop and log a \`BUGS.md\` entry.
- If the task body's Files list expands as you work, stop and re-run the council.
- If the chosen task requires approval and approval has not been given, stop.
`;
}

export function renderNextAction({ date, top, handoff }) {
  const approval = approvalRequired(top.risk);
  const filesList = top.task.files.length > 0 ? top.task.files.join(", ") : "(see task body in TASKS.md)";
  return `# NEXT_ACTION.md

> Generated by \`npm run agent:council\` on ${date}.
> The agent council picked the next task; read this before acting.

## STATUS

${approval ? "**APPROVAL_REQUIRED**" : "**SAFE_TO_PROCEED**"}

## Recommended next task

- **${top.task.id}** — ${top.task.title}

## Why

The agent council scored ${top.task.id} highest (${top.priorityScore.toFixed(2)})
on the rubric in \`docs/agent-council.md\`. Risk class: \`${top.risk}\`.

Last completed work (from HANDOFF.md): ${handoff.title ?? "—"} (${handoff.date ?? "—"}).

## Approval requirement

${approval
  ? `**Required.** Reason: risk class \`${top.risk}\` is in \`APPROVAL_REQUIRED_RISK\` per docs/approval-policy.md. Do not touch files in:\n${top.task.files.map((f) => `  - \`${f}\``).join("\n") || "  - (see TASKS.md)"}\nwithout explicit user "go".`
  : `**Not required.** This task is in a safe risk class (\`${top.risk}\`). Proceed under the verification plan below.`}

## Exact command / prompt to run next

If you are a fresh Claude Code session, start with:

> "Run ${top.task.id} as described in TASKS.md and the council report at reports/agent-council/latest.md. ${approval ? "Before any file edits, summarise the plan and ask me to approve." : "Proceed under the verification plan and report when done."}"

## Files likely touched

${filesList}

## Verification commands

\`\`\`
npm test
npm run typecheck
npm run check:data-policy
npm run check:agent-workspace
\`\`\`

## Rollback plan

- All edits should be reversible with \`git checkout -- <file>\` (no destructive ops without explicit approval).
- If a verification command fails after a change, revert with \`git checkout -- <file>\` and log the failure to \`BUGS.md\`.
- If the change is committed (it must not be without user approval), revert with \`git revert <hash>\`.
`;
}

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

function readMaybe(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

function countByStatus(tasks) {
  const acc = { ready: 0, inProgress: 0, blocked: 0, done: 0 };
  for (const t of tasks) {
    if (t.status === "ready") acc.ready++;
    else if (t.status === "in_progress") acc.inProgress++;
    else if (t.status === "blocked") acc.blocked++;
    else if (t.status === "done") acc.done++;
  }
  return acc;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

export function runCouncil({ executeSafe = false, now = new Date() } = {}) {
  const tasksMd = readMaybe("TASKS.md") ?? "";
  const bugsMd = readMaybe("BUGS.md") ?? "";
  const handoffMd = readMaybe("HANDOFF.md") ?? "";

  const tasks = parseTasks(tasksMd);
  const bugs = parseBugs(bugsMd);
  const handoff = parseLatestHandoff(handoffMd);

  const repoState = countByStatus(tasks);
  const candidates = selectCandidates(tasks);

  if (candidates.length === 0) {
    return {
      ok: false,
      stop: true,
      reason: "no ready tasks (or every ready task is blocked).",
    };
  }

  const scored = candidates.map((t) => scoreTask(t, tasks));
  const top = pickTop(scored);
  const date = now.toISOString();
  const approval = approvalRequired(top.risk);

  const report = renderCouncilReport({ date, repoState, candidates, scored, top, handoff, bugs });
  const next = renderNextAction({ date, top, handoff });

  // Write artifacts
  const outDir = join(ROOT, "reports", "agent-council");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stampPath = join(outDir, `${nowStamp()}.md`);
  const latestPath = join(outDir, "latest.md");
  writeFileSync(stampPath, report, "utf8");
  writeFileSync(latestPath, report, "utf8");
  writeFileSync(join(ROOT, "NEXT_ACTION.md"), next, "utf8");

  // Safe auto-execution: in v1 we only record permission, never act.
  const wouldAutoExecute =
    executeSafe && !approval && SAFE_AUTO_RISK.has(top.risk);

  return {
    ok: true,
    stop: false,
    chosen: top,
    approvalRequired: approval,
    wouldAutoExecute,
    artifactPaths: {
      stamp: relative(ROOT, stampPath),
      latest: relative(ROOT, latestPath),
      nextAction: "NEXT_ACTION.md",
    },
  };
}

function main(argv) {
  const executeSafe = argv.includes("--execute-safe");
  const result = runCouncil({ executeSafe });
  if (!result.ok) {
    console.log(`Pangzi agent council — STOP: ${result.reason}`);
    process.exit(1);
  }
  const t = result.chosen.task;
  console.log(`Pangzi agent council — picked ${t.id} (${t.title})`);
  console.log(`  score: ${result.chosen.priorityScore.toFixed(2)}  risk: ${result.chosen.risk}`);
  console.log(`  approval required: ${result.approvalRequired ? "YES" : "no"}`);
  if (executeSafe) {
    console.log(
      `  --execute-safe: ${result.wouldAutoExecute ? "would auto-execute (planner-only in v1; no action taken)" : "auto-execution blocked (task is not docs-only)"}`,
    );
  }
  console.log(`  report:      ${result.artifactPaths.stamp}`);
  console.log(`  next-action: ${result.artifactPaths.nextAction}`);
  process.exit(0);
}

// Only run as CLI when invoked directly, not when imported by tests.
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main(process.argv.slice(2));
}
