import {
	ArrowUpIcon,
	BotIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleXIcon,
	UserIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Fact } from "../finding-facts";
import type { Landed } from "../landed";
import { taskOutcome } from "./api";
import { Markdown } from "./markdown";
import { NamedContext } from "./mentioned";
import { type Decided, mergedFacts } from "./merged-facts";
import { SystemNameChip } from "./systems";

/**
 * How `task` went once it merged, under its card's report: its time, cost,
 * size and the calls the person and the agent made beside its project's
 * usual, the systems it touched, what the gate made of it, and anything that
 * went worse than it could have. Nothing while it loads, or for a task whose
 * merge was never recorded here.
 */
export function MergedStats({ task }: { task: string }): JSX.Element | null {
	const [landed, setLanded] = useState<Landed | null>(null);
	const named = useContext(NamedContext).systems;
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
							) : "added" in stat.value ? (
								<span>
									<span className="text-success">+{stat.value.added}</span>{" "}
									<span className="text-destructive">
										−{stat.value.removed}
									</span>
								</span>
							) : (
								<Decisions decided={stat.value} />
							)}
							{stat.high && (
								<ArrowUpIcon aria-label="above usual" className="size-3.5" />
							)}
						</dd>
						{stat.detail !== null && (
							<dd className="text-muted-foreground">{stat.detail}</dd>
						)}
					</div>
				))}
			</dl>
			{(landed.outcome.systems ?? []).length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-muted-foreground">Systems</span>
					<ul aria-label="systems" className="flex flex-wrap gap-1">
						{(landed.outcome.systems ?? []).map((name) => (
							<li key={name} className="flex min-w-0">
								<SystemNameChip name={name} systems={named} />
							</li>
						))}
					</ul>
				</div>
			)}
			{facts.gate === null ? (
				<p className="flex items-center gap-1.5 text-success">
					<CircleCheckIcon aria-hidden className="size-3.5" />
					Gate passed first try
				</p>
			) : (
				<Facts
					label="gate"
					facts={facts.gate}
					Icon={CircleXIcon}
					tone="text-destructive"
				/>
			)}
			{facts.findings.length > 0 && (
				<Facts
					label="findings"
					facts={facts.findings}
					Icon={CircleAlertIcon}
					tone="text-warning"
				/>
			)}
		</section>
	);
}

/** Who made the task's calls, a line each for the person and the agent. */
function Decisions({ decided }: { decided: Decided }): JSX.Element {
	const sides = [
		{ who: "you", count: decided.byYou, Icon: UserIcon },
		{ who: "agent", count: decided.byAgent, Icon: BotIcon },
	];
	return (
		<span className="flex flex-col">
			{sides.map(({ who, count, Icon }) => (
				<span key={who} className="flex items-center gap-1.5">
					<Icon aria-hidden className="size-3.5 text-muted-foreground" />
					{count} by {who}
				</span>
			))}
		</span>
	);
}

function Facts({
	label,
	facts,
	Icon,
	tone,
}: {
	label: string;
	facts: Fact[];
	Icon: typeof CircleAlertIcon;
	tone: string;
}): JSX.Element {
	return (
		<ul aria-label={label} className="flex flex-col gap-1.5">
			{facts.map((fact, index) => (
				<FindingLine
					// Two alike, as two stopped turns, are two lines.
					// biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders
					key={index}
					Icon={Icon}
					tone={tone}
				>
					<Markdown text={fact.text} className="[&_p]:my-0" />
					{fact.again !== null && (
						<span className="text-muted-foreground">{fact.again}</span>
					)}
				</FindingLine>
			))}
		</ul>
	);
}

/** One line of what went worse; `arbor merge` made a todo of it. */
function FindingLine({
	Icon,
	tone,
	children,
}: {
	Icon: typeof CircleAlertIcon;
	tone: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<li className="flex items-start gap-1.5">
			{/* A 14px icon on a 16px line sits a pixel down to center on it. */}
			<Icon aria-hidden className={cn("mt-px size-3.5 shrink-0", tone)} />
			<span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
				{children}
			</span>
		</li>
	);
}
