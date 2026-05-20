import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import type { RiskLevel } from "@/lib/types/signal";

const MAP: Record<RiskLevel, { tone: BadgeProps["tone"]; cn: string }> = {
  LOW: { tone: "info", cn: "低风险" },
  MEDIUM: { tone: "warn", cn: "中风险" },
  HIGH: { tone: "danger", cn: "高风险" },
  FORBIDDEN: { tone: "danger-solid", cn: "禁止" },
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  const m = MAP[level];
  return (
    <Badge tone={m.tone}>
      {m.cn}
      <span className="ml-1 opacity-60 text-[10px]">{level}</span>
    </Badge>
  );
}
