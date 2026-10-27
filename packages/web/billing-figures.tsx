import type { JSX, ReactNode } from "react";
import { useMoney } from "./billing-sums";

/** What `part` cost and its share of `of`, then `children`, in the meter's last column. */
export function Figures({
	part,
	of,
	children,
}: {
	part: number;
	of: number;
	children: ReactNode;
}): JSX.Element {
	const dollars = useMoney(true);
	return (
		<span className="flex items-baseline justify-end gap-2 tabular-nums max-md:col-start-2 max-md:row-start-1">
			<span className="font-medium text-sm">{dollars(part)}</span>
			<span className="w-9 text-right text-muted-foreground text-xs">
				{of === 0 ? "" : `${Math.round((part / of) * 100)}%`}
			</span>
			{children}
		</span>
	);
}
