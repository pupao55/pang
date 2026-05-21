import { describe, expect, it } from "vitest";
// @ts-ignore — JS module imported into TS test file; types are duck-asserted below.
import * as council from "../../../scripts/agent_council.mjs";

const {
  parseTasks,
  parseBugs,
  parseLatestHandoff,
  classifyRisk,
  scoreTask,
  selectCandidates,
  pickTop,
  approvalRequired,
  renderNextAction,
  renderCouncilReport,
  RISK_PENALTY,
} = council as {
  parseTasks: (md: string) => Task[];
  parseBugs: (md: string) => { open: number; resolved: number; items: unknown[] };
  parseLatestHandoff: (md: string) => { date: string | null; title: string | null };
  classifyRisk: (t: Task) => string;
  scoreTask: (t: Task, all: Task[]) => Scored;
  selectCandidates: (tasks: Task[]) => Task[];
  pickTop: (scored: Scored[]) => Scored;
  approvalRequired: (risk: string) => boolean;
  renderNextAction: (args: { date: string; top: Scored; handoff: { date: string | null; title: string | null } }) => string;
  renderCouncilReport: (args: unknown) => string;
  RISK_PENALTY: Record<string, number>;
};

interface Scored {
  task: Task;
  risk: string;
  riskPenalty: number;
  priorityScore: number;
  rubric: Record<string, number>;
}

interface Task {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  dependsOn: string[];
  files: string[];
  goal: string;
  body: string;
}

const TASKS_MD = `
## T-100: Update docs about something
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: \`docs/something.md\`, \`README.md\`
Goal: Tidy the documentation for X.

## T-200: Touch the score engine constants
Status: ready
Owner: backend
Priority: P1
Depends on: none
Files: \`src/lib/config/constants.ts\`, \`src/lib/engine/scoreEngine.ts\`
Goal: Adjust SCORE_WEIGHTS based on calibration.

## T-300: Wait on a missing dependency
Status: ready
Owner: product
Priority: P1
Depends on: T-999
Files: -
Goal: Should not be selected because T-999 isn't done.

## T-400: Already done
Status: done
Owner: backend
Priority: P0
Depends on: none
Files: -
Goal: Already shipped.

## T-500: History rewrite is destructive
Status: ready
Owner: backend
Priority: P1
Depends on: none
Files: \`data/baostock/\`
Goal: Run git filter-repo --path data/baostock/daily-bars --invert-paths to rewrite history.
`;

const BUGS_MD = `
### B-001: A real bug
Severity: major
Status: open
Source: somewhere

### B-002: A fixed bug
Severity: minor
Status: fixed
Source: somewhere
`;

const HANDOFF_MD = `
## TL;DR
some stuff

## Session log

### 2026-05-20 — Test session entry
- did things
`;

describe("agent_council parser", () => {
  it("parses tasks with status, owner, priority, depends-on, files", () => {
    const tasks = parseTasks(TASKS_MD);
    expect(tasks.length).toBe(5);
    const ids = tasks.map((t: Task) => t.id);
    expect(ids).toEqual(["T-100", "T-200", "T-300", "T-400", "T-500"]);
    const t300 = tasks.find((t: Task) => t.id === "T-300")!;
    expect(t300.dependsOn).toEqual(["T-999"]);
    const t200 = tasks.find((t: Task) => t.id === "T-200")!;
    expect(t200.priority).toBe("P1");
    expect(t200.files.some((f: string) => f.includes("constants.ts"))).toBe(true);
  });

  it("parses open vs resolved bugs", () => {
    const bugs = parseBugs(BUGS_MD);
    expect(bugs.open).toBe(1);
    expect(bugs.resolved).toBe(1);
    expect(bugs.items.length).toBe(2);
  });

  it("parses the most recent handoff entry", () => {
    const h = parseLatestHandoff(HANDOFF_MD);
    expect(h.date).toBe("2026-05-20");
    expect(h.title).toContain("Test session entry");
  });
});

describe("agent_council risk classification", () => {
  it("classifies docs-only tasks correctly", () => {
    const t = parseTasks(TASKS_MD).find((x: Task) => x.id === "T-100")!;
    expect(classifyRisk(t)).toBe("docs-only");
    expect(approvalRequired(classifyRisk(t))).toBe(false);
  });

  it("classifies strategy/scoring tasks as approval-required", () => {
    const t = parseTasks(TASKS_MD).find((x: Task) => x.id === "T-200")!;
    expect(classifyRisk(t)).toBe("strategy-scoring");
    expect(approvalRequired(classifyRisk(t))).toBe(true);
  });

  it("classifies destructive git ops as approval-required", () => {
    const t = parseTasks(TASKS_MD).find((x: Task) => x.id === "T-500")!;
    expect(classifyRisk(t)).toBe("destructive");
    expect(approvalRequired(classifyRisk(t))).toBe(true);
  });

  it("RISK_PENALTY matrix matches docs/agent-council.md", () => {
    expect(RISK_PENALTY["docs-only"]).toBe(0);
    expect(RISK_PENALTY["ui-only"]).toBe(2);
    expect(RISK_PENALTY["backend"]).toBe(4);
    expect(RISK_PENALTY["strategy-scoring"]).toBe(6);
    expect(RISK_PENALTY["destructive"]).toBe(10);
  });
});

describe("agent_council scoring + selection", () => {
  it("excludes meta / heartbeat tasks (T-AGENT-*) from candidates", () => {
    const md = `
## T-AGENT-001: Run the council
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: NEXT_ACTION.md
Goal: meta loop, should never be picked by the council itself.

## T-700: A real docs task
Status: ready
Owner: backend
Priority: P2
Depends on: none
Files: \`docs/foo.md\`
Goal: write docs.
`;
    const ids = selectCandidates(parseTasks(md)).map((t: Task) => t.id);
    expect(ids).toContain("T-700");
    expect(ids).not.toContain("T-AGENT-001");
  });

  it("excludes blocked tasks from candidates", () => {
    const tasks = parseTasks(TASKS_MD);
    const cands = selectCandidates(tasks);
    const ids = cands.map((t: { id: string }) => t.id);
    expect(ids).toContain("T-100");
    expect(ids).toContain("T-200");
    expect(ids).toContain("T-500");
    expect(ids).not.toContain("T-300"); // depends on T-999 which isn't done
    expect(ids).not.toContain("T-400"); // already done
  });

  it("prefers low-risk tasks over high-risk same-priority", () => {
    const tasks = parseTasks(TASKS_MD);
    const cands = selectCandidates(tasks);
    const scored = cands.map((t: Task) => scoreTask(t, tasks));
    const top = pickTop(scored);
    // T-100 is docs-only (penalty 0); T-200 is strategy-scoring (penalty 6);
    // T-500 is destructive (penalty 10). docs-only should win the tie-break.
    expect(top.task.id).toBe("T-100");
    expect(top.risk).toBe("docs-only");
  });
});

describe("agent_council rendering", () => {
  it("NEXT_ACTION.md renders verification commands and approval status", () => {
    const tasks = parseTasks(TASKS_MD);
    const scored = selectCandidates(tasks).map((t: Task) => scoreTask(t, tasks));
    const top = pickTop(scored);
    const md = renderNextAction({
      date: "2026-05-20T00:00:00Z",
      top,
      handoff: { date: "2026-05-20", title: "Test session entry" },
    });
    expect(md).toContain("# NEXT_ACTION.md");
    expect(md).toContain("SAFE_TO_PROCEED");
    expect(md).toContain("npm run check:data-policy");
    expect(md).toContain("npm run check:agent-workspace");
    expect(md).toContain(top.task.id);
  });

  it("NEXT_ACTION.md flags APPROVAL_REQUIRED for strategy tasks", () => {
    // Force the strategy task to win by removing the docs-only competitor.
    const tasks = parseTasks(TASKS_MD).filter((t: { id: string }) => t.id !== "T-100");
    const scored = selectCandidates(tasks).map((t: Task) => scoreTask(t, tasks));
    const top = pickTop(scored);
    const md = renderNextAction({
      date: "2026-05-20T00:00:00Z",
      top,
      handoff: { date: null, title: null },
    });
    expect(md).toContain("APPROVAL_REQUIRED");
    expect(md).toContain("docs/approval-policy.md");
  });

  it("council report includes scoring table + role picks + objections", () => {
    const tasks = parseTasks(TASKS_MD);
    const scored = selectCandidates(tasks).map((t: Task) => scoreTask(t, tasks));
    const top = pickTop(scored);
    const bugs = parseBugs(BUGS_MD);
    const md = renderCouncilReport({
      date: "2026-05-20T00:00:00Z",
      repoState: { ready: 3, inProgress: 0, blocked: 1, done: 1 },
      candidates: selectCandidates(tasks),
      scored,
      top,
      handoff: { date: "2026-05-20", title: "Test session entry" },
      bugs,
    });
    expect(md).toContain("## Scoring table");
    expect(md).toContain("## Agent proposals");
    expect(md).toContain("## Agent objections");
    expect(md).toContain(top.task.id);
  });
});
