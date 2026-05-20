import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium leading-tight",
  {
    variants: {
      tone: {
        default: "bg-gray-100 text-gray-700 border-gray-200",
        bull: "bg-red-50 text-red-700 border-red-200",
        bear: "bg-green-50 text-green-700 border-green-200",
        info: "bg-blue-50 text-blue-700 border-blue-200",
        warn: "bg-amber-50 text-amber-700 border-amber-200",
        danger: "bg-red-50 text-red-700 border-red-200",
        /** Filled danger — for FORBIDDEN / hard-block badges. */
        "danger-solid": "bg-red-600 text-white border-red-700",
        accent: "bg-indigo-50 text-indigo-700 border-indigo-200",
        violet: "bg-violet-50 text-violet-700 border-violet-200",
        orange: "bg-orange-50 text-orange-700 border-orange-200",
        rose: "bg-rose-50 text-rose-700 border-rose-200",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
