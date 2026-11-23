import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Tool } from "@splates/server/conversations";
import type { EvalDetail, EvalStep } from "@splates/server/evals/browser";
import { targetName } from "@splates/server/evals/browser";
import { ClockIcon, WrenchIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { evalRun } from "./api";
import { StillWaiting } from "./countdown";
import {
	checkStep,
	durationLabel,
	EvalJudgment,
	JudgeBox,
} from "./eval-judgment";
import { StatusChip } from "./eval-status";
import { Markdown } from "./markdown";
import { RecordedThread, recordedTurn } from "./recorded-thread";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";
import type { Work } from "./work";
import { type RecordedCall, type RecordedWork, WorkRow } from "./work-row";

// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
export function EvalDebug({
	id,
	onEvals,
	onReport,
}: {
	id: string;
	onEvals: () => void;
	onReport: () => void;
}): JSX.Element {
	const [run, setRun] = useState<EvalDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		void evalRun(id).then(
			(loaded) => {
				if (current) {
					setRun(loaded);
				}
			},
			(failed: unknown) => {
				if (current) {
					setError(failed instanceof Error ? failed.message : String(failed));
				}
			},
		);
		return () => {
			current = false;
		};
	}, [id]);
	const batch = run?.batch;
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					<RouteTrail
						items={[
							{ label: "Evals", onClick: onEvals },
							{
								label:
									batch === undefined
										? "Report"
										: `${batch.title} ×${batch.cells}`,
								onClick: onReport,
							},
							{ label: "Run" },
						]}
					/>
				}
			/>
			<section
				aria-label="eval run"
				className="mx-auto flex w-full max-w-[40rem] min-w-0 flex-col gap-3 pb-6"
			>
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				{run === null && error === null && <RunSkeleton />}
				{run !== null && <Run run={run} />}
			</section>
		</section>
	);
}

/** The run's loaded layout in pulsing blocks, so the page does not jump open. */
function RunSkeleton(): JSX.Element {
	return (
		<div
			role="status"
			aria-label="Reading the run…"
			className="flex flex-col gap-5"
		>
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Skeleton className="h-5 w-16 animate-pulse rounded-full" />
					<Skeleton className="h-5 w-[40%] animate-pulse" />
				</div>
				<Skeleton className="h-3 w-[30%] animate-pulse" />
				<Skeleton className="h-4 w-[70%] animate-pulse" />
			</div>
			<Skeleton className="h-20 animate-pulse rounded-lg" />
			<Skeleton className="h-28 animate-pulse rounded-lg" />
			<Skeleton className="h-16 animate-pulse rounded-lg" />
			<StillWaiting />
		</div>
	);
}

const RecordedWorkContext = createContext<RecordedWork | null>(null);

const EvalWorkUI = makeAssistantDataUI<{ work: Work }>({
	name: "work",
	render: ({ data }) => {
		const recorded = useContext(RecordedWorkContext);
		return (
			<WorkRow work={data.work} {...(recorded === null ? {} : { recorded })} />
		);
	},
});

function Run({ run }: { run: EvalDetail }): JSX.Element {
	const harness = run.harness !== undefined;
	const { messages, calls } = useMemo(() => {
		const records = new Map<string, RecordedCall>();
		const tools = harness
			? []
			: run.transcript.flatMap((step, index) => {
					if (step.kind !== "tool") {
						return [];
					}
					const id = stepId(index);
					const checks = run.checks.filter(
						(check) => checkStep(check, run)?.index === index,
					);
					records.set(id, {
						elapsed: durationLabel(step.milliseconds),
						annotation:
							checks.length === 0
								? null
								: checks.map((check) => (
										<JudgeBox
											key={check.id}
											tone="fail"
											title={
												<>
													Judged: <code>{check.id}</code> failed here
												</>
											}
										>
											<div className="px-3 py-2">
												<Markdown text={`**Expected** · ${check.about}`} />
												<Markdown text={check.step?.observed ?? ""} />
											</div>
										</JudgeBox>
									)),
					});
					return [asTool(step, id)];
				});
		return {
			calls: records,
			messages: recordedTurn(
				run.id,
				run.input,
				tools,
				harness ? "" : run.reply,
				tools.length > 0 || (!harness && run.phases?.agentMs !== undefined),
			),
		};
	}, [run, harness]);
	const [open, setOpen] = useState(() =>
		run.checks.some((check) => checkStep(check, run) !== undefined),
	);
	const recorded = {
		calls,
		open,
		onOpenChange: setOpen,
		elapsed: durationLabel(run.phases?.agentMs),
	};
	const jumpTo = (index: number) => {
		flushSync(() => setOpen(true));
		const row = document.getElementById(stepId(index));
		row?.focus({ preventScroll: true });
		row?.scrollIntoView({ block: "nearest" });
	};
	const setup = durationLabel(run.phases?.setupMs);
	return (
		<>
			<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
				{harness ? (
					<span className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 font-medium text-muted-foreground text-xs">
						<WrenchIcon aria-hidden className="size-3" /> harness
					</span>
				) : (
					<StatusChip status={run.status} />
				)}
				<h2 className="font-semibold wrap-anywhere">{run.scenario}</h2>
				<span className="text-muted-foreground text-xs wrap-anywhere">
					{targetName(run.target)}
					{run.repetition > 0 && ` · repetition ${run.repetition + 1}`}
				</span>
			</header>
			{harness ? (
				<JudgeBox
					tone="neutral"
					title={
						run.harness === "skipped"
							? "Skipped after a harness error"
							: "Never reached the agent"
					}
					meta={durationLabel(run.milliseconds)}
				>
					<div className="px-3 py-2">
						<Markdown text={run.error ?? run.reason ?? ""} />
						<p>This run is left out of pass rates.</p>
					</div>
				</JudgeBox>
			) : (
				setup !== undefined && (
					<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<ClockIcon aria-hidden className="size-3.5" /> Sandbox ready in{" "}
						{setup}
					</p>
				)
			)}
			<div className={harness ? "opacity-55" : undefined}>
				<RecordedWorkContext.Provider value={recorded}>
					<RecordedThread messages={messages}>
						<EvalWorkUI />
					</RecordedThread>
				</RecordedWorkContext.Provider>
			</div>
			{harness ? (
				<p className="text-muted-foreground text-xs">
					The agent was not started.
				</p>
			) : (
				<>
					{run.reply === "" && (
						<p className="text-muted-foreground text-xs">No reply.</p>
					)}
					<EvalJudgment run={run} onStep={jumpTo} />
				</>
			)}
			{run.url !== undefined && (
				<a
					href={run.url}
					target="_blank"
					rel="noreferrer"
					className="w-fit text-sm underline"
				>
					Open in its framework
				</a>
			)}
		</>
	);
}

function stepId(index: number): string {
	return `eval-step-${index}`;
}

function asTool(step: Extract<EvalStep, { kind: "tool" }>, id: string): Tool {
	const input = shortInput(step.input);
	return {
		type: "tool",
		id,
		title: input === "" ? step.name : `${step.name}: ${input}`,
		status: "completed",
		kind: null,
		command: null,
		target: null,
		output: [step.input, step.output].filter(Boolean).join("\n\n"),
		edits: [],
		paths: [],
		parent: null,
		at: null,
		until: null,
		flags: [],
		decision: null,
	};
}

function shortInput(input: string): string {
	try {
		const value = JSON.parse(input) as unknown;
		if (value !== null && typeof value === "object") {
			const args = Object.values(value);
			if (args.length === 0) {
				return "";
			}
			if (args.length === 1 && typeof args[0] === "string") {
				return args[0];
			}
		}
	} catch {
		return input;
	}
	return input;
}
