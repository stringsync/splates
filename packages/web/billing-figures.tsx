import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import { useMoney } from "./billing-sums";

/** Side-by-side actual ("You pay") and API-equivalent ("At API") figures, then `children`. */
export function Figures({
	paid,
	atApi,
	children,
}: {
	/** Actual amount paid; null when the row only reflects API-equivalent plan usage. */
	paid: number | null;
	/** What the row's usage would cost at API list prices; null for a pure subscription fee row. */
	atApi: number | null;
	children: ReactNode;
}): JSX.Element {
	const dollars = useMoney(true);
	return (
		<>
			<span
				className={cn(
					"text-right font-medium text-sm tabular-nums max-md:hidden",
					paid === null || paid === 0
						? "text-muted-foreground font-normal"
						: "text-foreground",
				)}
			>
				{paid === null ? "-" : dollars(paid)}
			</span>
			<span className="flex items-center justify-end gap-1.5 text-right text-muted-foreground text-xs tabular-nums max-md:col-start-2 max-md:row-start-1">
				<span className="flex flex-col items-end">
					<span
						className={cn(
							"md:hidden font-medium text-sm",
							paid === null || paid === 0
								? "text-muted-foreground font-normal"
								: "text-foreground",
						)}
					>
						{paid === null ? "-" : dollars(paid)}
					</span>
					<span className="text-muted-foreground text-[13px] max-md:text-xs">
						{atApi === null ? (
							"-"
						) : (
							<>
								<span className="md:hidden">API </span>
								{dollars(atApi)}
							</>
						)}
					</span>
				</span>
				{children}
			</span>
		</>
	);
}
