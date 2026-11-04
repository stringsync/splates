import type { Cascade } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { CircleCheckIcon, CircleSlashIcon, CircleXIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "./lib/utils";
import { PlanSteps } from "./ship-plan-steps";
import {
	lasted,
	type Recap,
	type RecapProject,
	type RecapRow,
	recapOf,
} from "./ship-recap-figures";
import { acknowledge } from "./ship-recap-seen";

const TONES: Record<RecapRow["tone"], string> = {
	quiet: "bg-muted-foreground/40",
	slow: "bg-amber-500",
	failed: "bg-destructive",
	person: "bg-sky-400",
};

/**
 * What a finished ship comes to, shown until the person acknowledges it:
 * how long it took, split into what the machine spent and what waited on
 * them, the step that ran longest past its expected time, any errors, and
 * every step of every project against the time it was expected to take.
 * Plan another ship acknowledges it and goes back to the plan.
 */
export function ShipRecap({ cascade }: { cascade: Cascade }): JSX.Element {
	const recap = recapOf(cascade, Date.now());
	const done = cascade.status === "done";
	const Icon = done
		? CircleCheckIcon
		: cascade.status === "abandoned"
			? CircleSlashIcon
			: CircleXIcon;
	const title = done
		? `Shipped ${cascade.steps.length === 1 ? shipName(cascade.from) : `${cascade.steps.length} projects`} in ${lasted(recap.total)}`
		: `Stopped after ${lasted(recap.total)}`;
	return (
		<section aria-label="ship recap" className="flex flex-col gap-4">
			<PlanSteps step={3} />
			<h2 className="flex items-center gap-2 font-medium text-lg">
				<Icon
					aria-hidden
					className={cn(
						"size-5",
						done
							? "text-green-600 dark:text-green-400"
							: "text-muted-foreground",
					)}
				/>
				{title}
			</h2>
			<Facts recap={recap} />
			<div className="flex flex-col gap-4">
				{recap.projects.map((project) => (
					<Project key={project.slug} project={project} />
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				Each bar is the time a step took; the line marks how long it is expected
				to take from earlier ships. Orange ran over, blue waited on you.
			</p>
			{cascade.status !== "stopped" && (
				<Button
					className="self-start pointer-coarse:min-h-11"
					onClick={() => {
						acknowledge(cascade.id);
						location.hash = "ships";
					}}
				>
					Plan another ship
				</Button>
			)}
		</section>
	);
}

function Facts({ recap }: { recap: Recap }): JSX.Element {
	return (
		<ul className="flex flex-col gap-1 text-sm">
			<li className="text-muted-foreground">
				Machine {lasted(recap.machine)}
				{recap.person > 0 && (
					<>
						{" "}
						· Waiting on you {lasted(recap.person)} (sign-in, 2FA, npm approval)
					</>
				)}
			</li>
			{recap.slowest !== null && (
				<li className="text-amber-600 dark:text-amber-400">
					Slowest: {recap.slowest.row.name} of {recap.slowest.project} took{" "}
					{lasted(recap.slowest.row.spent)}, expected about{" "}
					{lasted(recap.slowest.row.expected)}
				</li>
			)}
			{recap.errors.length === 0 ? (
				<li className="text-muted-foreground">No errors</li>
			) : (
				recap.errors.map((error) => (
					<li
						key={`${error.project}${error.text}`}
						className="text-destructive"
					>
						{error.project}: {error.text}
					</li>
				))
			)}
			<li className="text-muted-foreground">
				{recap.agents.length === 0
					? "Not sent to an agent"
					: `Sent to an agent for ${recap.agents.join(", ")}`}
			</li>
		</ul>
	);
}

/** A project's steps; a project that went as expected folds into its heading. */
function Project({ project }: { project: RecapProject }): JSX.Element {
	const scale = Math.max(
		1,
		...project.rows.flatMap((row) => [row.spent, row.expected]),
	);
	const heading = (
		<span className="flex w-full items-center justify-between gap-2">
			<span className="font-medium">{shipName(project.slug)}</span>
			<span className="text-muted-foreground tabular-nums">
				{lasted(project.spent)}
			</span>
		</span>
	);
	const rows = (
		<ol aria-label={`${project.slug} steps`} className="flex flex-col gap-1">
			{project.rows.map((row) => (
				<li
					key={row.key}
					className={cn(
						"grid grid-cols-[9rem_1fr_5rem] items-center gap-2 text-sm",
						row.tone === "quiet" && "text-muted-foreground",
					)}
				>
					<span className="truncate">{row.name}</span>
					<span className="relative h-2 rounded bg-muted">
						<span
							className={cn(
								"absolute inset-y-0 left-0 rounded",
								TONES[row.tone],
							)}
							style={{ width: `${(row.spent / scale) * 100}%` }}
						/>
						{row.expected > 0 && (
							<span
								className="absolute -inset-y-0.5 w-0.5 bg-foreground"
								style={{ left: `${(row.expected / scale) * 100}%` }}
							/>
						)}
					</span>
					<span
						className={cn(
							"text-right tabular-nums",
							row.tone === "slow" && "text-amber-600 dark:text-amber-400",
							row.tone === "failed" && "text-destructive",
						)}
					>
						{lasted(row.spent)}
					</span>
				</li>
			))}
		</ol>
	);
	return project.clean ? (
		<details
			aria-label={project.slug}
			className="rounded-lg border bg-card p-3"
		>
			<summary className="flex cursor-pointer text-sm">{heading}</summary>
			<div className="pt-2">{rows}</div>
		</details>
	) : (
		<section
			aria-label={project.slug}
			className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
		>
			{heading}
			{rows}
		</section>
	);
}
