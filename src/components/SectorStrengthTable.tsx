import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { SectorSnapshot } from "@/lib/types/market";

export function SectorStrengthTable({
  sectors,
  title,
  cnTitle,
  ascending = false,
}: {
  sectors: SectorSnapshot[];
  title: string;
  cnTitle: string;
  ascending?: boolean;
}) {
  const sorted = [...sectors].sort((a, b) =>
    ascending ? a.momentumScore - b.momentumScore : b.momentumScore - a.momentumScore,
  );
  const top = sorted.slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {cnTitle} <span className="text-subtle text-xs ml-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="text-left py-1">板块</th>
              <th className="text-right">涨幅</th>
              <th className="text-right">涨停</th>
              <th className="text-right">动量</th>
              <th className="text-right">排名</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s) => (
              <tr key={s.sectorName} className="border-t border-border">
                <td className="py-1.5">{s.sectorName}</td>
                <td className={`text-right font-mono ${s.pctChange >= 0 ? "text-bull" : "text-bear"}`}>
                  {s.pctChange.toFixed(2)}%
                </td>
                <td className="text-right font-mono">{s.limitUpCount}</td>
                <td className="text-right font-mono">{s.momentumScore}</td>
                <td className="text-right font-mono text-muted">#{s.strengthRank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
