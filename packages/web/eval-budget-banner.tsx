import type { EvalBudgetView } from "@splates/server/evals/browser";
import { ZapIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { evalBudget } from "./api";
import { dollars } from "./eval-status";

/** How often a conversation with a seeded eval budget refreshes its spend. */
const REFRESH_MS = 15_000;

/**
 * The banner atop a conversation whose eval budget was pre-approved by the
 * automation that started it (rather than by hand on a budget card), showing
 * the automation name and live spend. Nothing for any other conversation.
 */
export function EvalBudgetBanner({
	conversation,
}: {
	conversation: string;
}): JSX.Element | null {
	const [budget, setBudget] = useState<EvalBudgetView | null>(null);
	const load = useCallback(
		() =>
			evalBudget(conversation).then(
				(next) => setBudget(next),
				() => {},
			),
		[conversation],
	);
	useEffect(() => {
		void load();
		const timer = setInterval(() => void load(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [load]);
	const seeded = budget?.seeded;
	if (budget === null || seeded === undefined) {
		return null;
	}
	const left = Math.max(0, budget.usd - budget.spent);
	const share = budget.usd > 0 ? Math.min(1, budget.spent / budget.usd) : 1;
	const label = seeded.name ?? `#${seeded.automation}`;
	return (
		<section
			role="status"
			aria-label="automation eval budget"
			className="flex items-center gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/5 px-4 py-2.5 text-sm"
		>
			<span
				aria-hidden
				className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-500/15"
			>
				<ZapIcon className="size-3.5 fill-violet-500/25 text-violet-600 dark:text-violet-400" />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="min-w-0 text-sm leading-snug">
					<strong className="font-semibold tabular-nums">
						{dollars(seeded.usd)}
					</strong>{" "}
					eval budget approved by automation{" "}
					<strong className="font-semibold">{label}</strong>
					{budget.usd > seeded.usd && (
						<span className="text-muted-foreground tabular-nums">
							{" "}
							· {dollars(budget.usd)} total
						</span>
					)}
				</p>
				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs tabular-nums">
					<span>
						{money(budget.spent)} of {money(budget.usd)} spent · {money(left)}{" "}
						left
					</span>
					<div
						aria-hidden
						className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"
					>
						<div
							className={cn(
								"h-full rounded-full",
								share >= 1 ? "bg-destructive" : "bg-foreground",
							)}
							style={{ width: `${share * 100}%` }}
						/>
					</div>
				</div>
			</div>
		</section>
	);
}

function money(usd: number): string {
	return `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
}
