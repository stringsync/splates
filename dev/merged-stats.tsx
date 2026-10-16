import {
	ArrowUpIcon,
	CheckIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleXIcon,
	SearchIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Landed } from "../landed";
import { taskOutcome } from "./api";
import { ReplyContext } from "./card-reply";
import { DeferButton } from "./defer";
import { Markdown } from "./markdown";
import {
	deferred,
	deferredLeft,
	type Fact,
	investigation,
	mergedFacts,
} from "./merged-facts";
import { Refusal, useRefusal } from "./refusal";

/**
 * How `task` went once it merged, under its card's report: its time, cost,
 * size and the person's part beside its project's usual, what the gate made
 * of it, and anything that went worse than it could have. Nothing while it
 * loads, or for a task whose merge was never recorded here.
 */
export function MergedStats({ task }: { task: string }): JSX.Element | null {
	const [landed, setLanded] = useState<Landed | null>(null);
	const send = useContext(ReplyContext)?.send ?? null;
	const [investigating, setInvestigating] = useState(false);
	const { refusal, attempt } = useRefusal();
	useEffect(() => {
		let current = true;
		taskOutcome(task).then(
			(read) => current && setLanded(read),
			// A card says what it can; the report above it stands alone.
			() => {},
		);
		return () => {
			current = false;
		};
	}, [task]);
	if (landed === null) {
		return null;
	}
	const facts = mergedFacts(landed);
	const found = facts.gate !== null || facts.findings.length > 0;
	return (
		<section
			aria-label="how it went"
			className="flex flex-col gap-3 border-t px-4 py-3 text-xs"
		>
			<dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-4">
				{facts.stats.map((stat) => (
					<div key={stat.label} className="flex min-w-0 flex-col">
						<dt className="text-muted-foreground">{stat.label}</dt>
						<dd
							className={cn(
								"flex items-center gap-1 font-medium text-sm tabular-nums",
								stat.high && "text-warning",
							)}
							title={stat.high ? "Above this project's usual" : undefined}
						>
							{typeof stat.value === "string" ? (
								stat.value
							) : (
								<span>
									<span className="text-success">+{stat.value.added}</span>{" "}
									<span className="text-destructive">
										−{stat.value.removed}
									</span>
								</span>
							)}
							{stat.high && (
								<ArrowUpIcon aria-label="above usual" className="size-3.5" />
							)}
						</dd>
						{stat.detail !== null && (
							<dd className="text-muted-foreground">{stat.detail}</dd>
						)}
						{stat.median !== null && (
							<dd className="text-muted-foreground">median {stat.median}</dd>
						)}
					</div>
				))}
			</dl>
			{facts.gate === null ? (
				<p className="flex items-center gap-1.5 text-success">
					<CircleCheckIcon aria-hidden className="size-3.5" />
					Gate passed first try
				</p>
			) : (
				<Facts
					label="gate"
					task={task}
					facts={facts.gate}
					Icon={CircleXIcon}
					tone="text-destructive"
				/>
			)}
			{facts.findings.length > 0 && (
				<Facts
					label="findings"
					task={task}
					facts={facts.findings}
					Icon={CircleAlertIcon}
					tone="text-warning"
				/>
			)}
			{found && send !== null && (
				<div className="flex flex-col items-end gap-1">
					{investigating ? (
						<span className="flex items-center gap-1 text-success">
							<CheckIcon className="size-3.5" strokeWidth={3} />
							Investigating
						</span>
					) : (
						<Button
							size="sm"
							onClick={async () =>
								setInvestigating(
									await attempt(
										send(investigation(task, facts)),
										"Not investigated",
									),
								)
							}
							className="gap-1.5 pointer-coarse:h-10"
						>
							<SearchIcon data-icon="inline-start" />
							Investigate
						</Button>
					)}
					<Refusal refusal={refusal} />
				</div>
			)}
		</section>
	);
}

/**
 * What an Investigated report left unfixed in `task`, a line each with Defer,
 * under what it fixed.
 */
export function Leftovers({
	task,
	left,
}: {
	task: string;
	left: string[];
}): JSX.Element {
	return (
		<ul
			aria-label="left unfixed"
			className="flex flex-col gap-1 border-t px-4 py-3 text-xs"
		>
			{left.map((line) => (
				<li key={line} className="flex items-start gap-1.5">
					<CircleAlertIcon
						aria-hidden
						className="mt-1 size-3.5 shrink-0 text-warning"
					/>
					<Markdown text={line} className="min-w-0 flex-1 [&_p]:my-0" />
					<DeferButton todo={deferredLeft(task, line)} />
				</li>
			))}
		</ul>
	);
}

function Facts({
	label,
	task,
	facts,
	Icon,
	tone,
}: {
	label: string;
	task: string;
	facts: Fact[];
	Icon: typeof CircleAlertIcon;
	tone: string;
}): JSX.Element {
	return (
		<ul aria-label={label} className="flex flex-col gap-1">
			{facts.map((fact, index) => (
				// Two alike, as two stopped turns, are two lines.
				// biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders
				<li key={index} className="flex items-start gap-1.5">
					<Icon aria-hidden className={cn("mt-1 size-3.5 shrink-0", tone)} />
					{/* Beside its line where it fits, under it where it does not. */}
					<span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
						<Markdown text={fact.text} className="[&_p]:my-0" />
						{fact.again !== null && (
							<span className="text-muted-foreground">{fact.again}</span>
						)}
					</span>
					<DeferButton todo={deferred(task, fact)} />
				</li>
			))}
		</ul>
	);
}
