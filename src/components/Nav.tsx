"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const links: { href: string; label: string; cn: string }[] = [
  { href: "/dashboard", label: "Dashboard", cn: "市场情绪" },
  { href: "/signals", label: "Signals", cn: "选股信号" },
  { href: "/backtest", label: "Backtest", cn: "策略回测" },
  { href: "/validation", label: "Validation", cn: "历史验证" },
  { href: "/review", label: "Review", cn: "复盘" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border bg-white sticky top-0 z-10">
      <div className="mx-auto max-w-[1600px] flex items-center gap-8 px-6 h-14">
        <Link href="/dashboard" className="font-semibold text-ink whitespace-nowrap">
          胖子 <span className="text-muted text-xs font-normal">Pangzi · A-share Research</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "px-3 py-1.5 rounded-md transition-colors whitespace-nowrap",
                  active
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-muted hover:bg-gray-100 hover:text-ink",
                )}
              >
                <span>{l.cn}</span>
                <span
                  className={cn(
                    "ml-1.5 text-[10px]",
                    active ? "text-blue-500" : "text-subtle",
                  )}
                >
                  {l.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
