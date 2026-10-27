import type { ProjectTotal } from "@stringsync/splates-server/spend";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { Figures } from "./billing-figures";
import { byProject, useMoney, whole } from "./billing-sums";
import { METER_COLUMNS, Meter } from "./meter";

/**
 * The Billing page's By project card for a report's `projects`: each
 * project's share of the bill, its plan use at API prices under it, and
 * Unassigned last for provider bills and plan fees. Renders nothing when no
 * project spent anything.
 */
export function ByProject({
	projects,
}: {
	projects: readonly ProjectTotal[];
}): JSX.Element | null {
	const rows = byProject(projects);
	if (rows.length === 0) {
		return null;
	}
	const all = rows.reduce((total, each) => total + whole(each), 0);
	return (
		<div className="flex flex-col rounded-xl border bg-card shadow-xs">
			<h3 className="border-b px-4 py-2.5 font-medium text-sm">By project</h3>
			<ul
				aria-label="by project"
				className={cn("grid gap-x-3 px-4 py-1", METER_COLUMNS)}
			>
				{rows.map((each) => (
					<ProjectRow key={each.project ?? ""} spent={each} all={all} />
				))}
			</ul>
		</div>
	);
}

function ProjectRow({
	spent,
	all,
}: {
	spent: ProjectTotal;
	all: number;
}): JSX.Element {
	const dollars = useMoney(true);
	return (
		<li className="col-span-full grid grid-cols-subgrid items-center border-b py-3 last:border-b-0 max-md:gap-y-2">
			<span className="flex min-w-0 flex-col">
				{spent.project === null ? (
					<span
						title="Provider bills and plan fees, which no project's work is recorded against"
						className="truncate font-medium text-muted-foreground text-sm"
					>
						Unassigned
					</span>
				) : (
					<span className="truncate font-medium text-sm">{spent.project}</span>
				)}
				{spent.equivalent > 0 && (
					<span
						title="What plan use would cost at API list prices, not money paid"
						className="text-muted-foreground text-xs"
					>
						{dollars(spent.equivalent)} plan use
					</span>
				)}
			</span>
			<Meter
				used={all === 0 ? 0 : whole(spent) / all}
				color="var(--foreground)"
				className="max-md:col-span-full max-md:row-start-2"
			/>
			<Figures part={whole(spent)} of={all}>
				{/* As wide as a provider's chevron, so the figures line up with that card's. */}
				<span aria-hidden className="size-4 shrink-0" />
			</Figures>
		</li>
	);
}
