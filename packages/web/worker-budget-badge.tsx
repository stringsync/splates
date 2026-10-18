import type { WorkerBudgetReport } from "@stringsync/splates-server/workers";
import { dollars } from "@stringsync/splates-server/workers/browser";
import { CoinsIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * In the header once any worker budget limit is at 80% or more: which, and
 * how far, amber as it nears and red once reached, opening the Budget
 * page. Silent below 80%, so it is never noise.
 */
export function WorkerBudgetBadge({
	budget,
}: {
	budget: WorkerBudgetReport | null | undefined;
}): JSX.Element | null {
	const worst = (budget?.standing ?? [])
		.filter((each) => each.tier > 0)
		.toSorted((one, other) => other.tier - one.tier)[0];
	if (budget == null || worst === undefined) {
		return null;
	}
	const unit = worst.limit === "hour" ? "/h" : "";
	const of =
		worst.limit === "hour"
			? `the ${dollars(worst.dollars)}/h rate cap`
			: `${worst.window === "today" ? "today's" : "this month's"} ${dollars(worst.dollars)}`;
	const reached = worst.tier === 100;
	return (
		<a
			href="#budget"
			title={`Made workers: ${dollars(worst.spent)}${unit} of ${dollars(worst.dollars)}${unit} ${worst.window}, an estimate at list price.${budget.stopped === null ? "" : ` Stopped: ${budget.stopped}; made workers take nothing new.`} Raise it with \`splates budget raise\`.`}
			className={cn(
				"flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-[11px] leading-none",
				reached
					? "border-destructive/30 bg-destructive/10 text-destructive"
					: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
			)}
		>
			<CoinsIcon className="size-3" />
			{reached ? `Workers: ${of} reached` : `Workers: ${worst.tier}% of ${of}`}
		</a>
	);
}
