import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import type { SignalType, SuggestedAction } from "@/lib/types/signal";

const SIGNAL_LABELS: Record<
  SignalType,
  { cn: string; tone: BadgeProps["tone"] }
> = {
  BREAKOUT: { cn: "突破", tone: "rose" },
  PULLBACK: { cn: "回踩", tone: "violet" },
  REVERSAL: { cn: "反包", tone: "orange" },
  SECOND_BUY: { cn: "二买", tone: "accent" },
  WATCH_ONLY: { cn: "观察", tone: "default" },
};

const ACTION_LABELS: Record<
  SuggestedAction,
  { cn: string; tone: BadgeProps["tone"] }
> = {
  STANDARD_POSITION: { cn: "标准仓位", tone: "bull" },
  LIGHT_POSITION: { cn: "轻仓试", tone: "info" },
  WATCH: { cn: "观望", tone: "default" },
  AVOID: { cn: "回避", tone: "danger-solid" },
};

export function SignalTypeBadge({ type }: { type: SignalType }) {
  const m = SIGNAL_LABELS[type];
  return (
    <Badge tone={m.tone}>
      {m.cn}
      <span className="ml-1 opacity-60 text-[10px]">{type}</span>
    </Badge>
  );
}

export function ActionBadge({ action }: { action: SuggestedAction }) {
  const m = ACTION_LABELS[action];
  return (
    <Badge tone={m.tone}>
      {m.cn}
      <span className="ml-1 opacity-60 text-[10px]">{action}</span>
    </Badge>
  );
}

export function StrategyNameBadge({ name }: { name: string }) {
  return <Badge tone="info">{name}</Badge>;
}
