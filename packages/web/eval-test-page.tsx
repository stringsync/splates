import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type {
	EvalBatch,
	EvalCell,
	EvalDetail,
	EvalGrid,
	EvalScenario,
	EvalTarget,
} from "@splates/server/evals/browser";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	PanelLeftIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { AgentMark } from "./agent-icons";
import { evalBatch, evalBatches, evalRun, evalScenarios } from "./api";
import { RunConversation, startsOpen } from "./eval-debug";
import { durationLabel } from "./eval-judgment";
import {
	type SpecFailureRow,
	type SpecTestRow,
	summarizeTests,
	targetDisplay,
} from "./eval-spec-data";
import { CauseChip } from "./eval-spec-results";
import { cn } from "./lib/utils";
import { Markdown } from "./markdown";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/** One model's runs of the test, in repetition order. */
interface ModelRuns {
	target: EvalTarget;
	cells: EvalCell[];
	passed: number;
	graded: number;
	errored: number;
}

/** The runs of a test grouped by model, in the order the batch lists its targets. */
export function modelRuns(grid: EvalGrid, scenario: string): ModelRuns[] {
	return grid.targets.flatMap((target) => {
		const cells = grid.grid
			.filter(
				(cell) => cell.scenario === scenario && cell.target === target.key,
			)
			.sort((first, second) => first.repetition - second.repetition);
		if (cells.length === 0) {
			return [];
		}
		const status = (cell: EvalCell) => cell.run?.status;
		return [
			{
				target,
				cells,
				passed: cells.filter((cell) => status(cell) === "pass").length,
				graded: cells.filter(
					(cell) => status(cell) === "pass" || status(cell) === "fail",
				).length,
				errored: cells.filter((cell) => status(cell) === "error").length,
			},
		];
	});
}

/** The run a test page lands on: the earliest failed one, else the first that landed. */
export function firstRun(
	test: SpecTestRow | undefined,
	grid: EvalGrid,
): string | null {
	return (
		test?.failures[0]?.failure.runs[0] ??
		grid.grid.find((cell) => cell.scenario === test?.id && cell.run !== null)
			?.run?.id ??
		null
	);
}

/**
 * One test opened to every run of it, grouped by model, with the picked run's
 * conversation, grading and diagnosis. Pass onPick to move between runs and onRound to move between rounds.
 */
export function EvalTestPage({
	batch,
	scenario,
	run,
	onEvals,
	onPick,
	onRound,
}: {
	batch: string;
	scenario: string;
	run: string | null;
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
	onEvals: () => void;
	onPick: (run: string) => void;
	onRound: (batch: string) => void;
}): JSX.Element {
	const [grids, setGrids] = useState<Record<string, EvalGrid>>({});
	const [lastBatch, setLastBatch] = useState<string | null>(null);
	const [scenarios, setScenarios] = useState<EvalScenario[]>([]);
	const [rounds, setRounds] = useState<EvalBatch[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [runsOpen, setRunsOpen] = useState(false);
	const cachedGrid = grids[batch] ?? null;
	useEffect(() => {
		setError(null);
		if (cachedGrid !== null) {
			setLastBatch(batch);
			return;
		}
		let current = true;
		evalBatch(batch).then(
			(each) => {
				if (!current) {
					return;
				}
				setGrids((prev) => ({ ...prev, [batch]: each }));
				setLastBatch(batch);
			},
			(failed: unknown) =>
				current &&
				setError(failed instanceof Error ? failed.message : String(failed)),
		);
		return () => {
			current = false;
		};
	}, [batch, cachedGrid]);
	const grid =
		cachedGrid ?? (lastBatch === null ? null : (grids[lastBatch] ?? null));
	const switchingRound = grid !== null && cachedGrid === null;
	useEffect(() => {
		let current = true;
		evalScenarios().then(
			(each) => current && setScenarios(each),
			() => undefined,
		);
		evalBatches().then(
			(each) => current && setRounds(each ?? []),
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, []);
	const test = useMemo(
		() =>
			grid === null
				? undefined
				: summarizeTests(grid, scenarios).find((each) => each.id === scenario),
		[grid, scenarios, scenario],
	);
	const def = scenarios.find((each) => each.id === scenario);
	const skill = def?.skill ?? grid?.skill ?? null;
	// A round is a batch of the same conversation, oldest first.
	const sameRound = useMemo(() => {
		const mine = rounds.find((each) => each.id === batch);
		const all =
			mine?.conversation === undefined
				? mine === undefined
					? []
					: [mine]
				: rounds.filter((each) => each.conversation === mine.conversation);
		return [...all].sort((first, second) =>
			first.startedAt.localeCompare(second.startedAt),
		);
	}, [rounds, batch]);
	const roundNumber = sameRound.findIndex((each) => each.id === batch) + 1;
	const picked = run ?? (grid === null ? null : firstRun(test, grid));
	const models = useMemo(
		() => (grid === null ? [] : modelRuns(grid, scenario)),
		[grid, scenario],
	);
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-4">
			<TopBar
				title={
					<RouteTrail
						items={[{ label: "Evals", onClick: onEvals }, { label: "Test" }]}
					/>
				}
			/>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{grid === null && error === null && (
				<p role="status" className="text-muted-foreground text-sm">
					Reading the test…
				</p>
			)}
			{grid !== null && (
				<div className="@container overflow-hidden rounded-xl border bg-card">
					<header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b bg-muted/40 px-4 py-3 @4xl:px-5">
						<button
							type="button"
							aria-label="Open runs"
							onClick={() => setRunsOpen(true)}
							className="hidden size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @max-4xl:inline-flex"
						>
							<PanelLeftIcon aria-hidden className="size-4" />
						</button>
						<div className="min-w-0 flex-1">
							<div className="truncate text-muted-foreground text-[13px]">
								{[skill === null ? null : `${skill} skill`, def?.group]
									.filter((part): part is string => !!part)
									.map((part) => `${part} › `)
									.join("")}
								<b className="font-medium text-foreground">
									{test?.sentence ?? scenario}
								</b>
							</div>
						</div>
						{test?.causes.map((cause) => (
							<CauseChip key={cause} cause={cause} />
						))}
						<div className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-[13px] tabular-nums @max-md:w-full @max-md:justify-between @max-md:pl-9">
							<span>{test?.passRate == null ? "-" : `${test.passRate}%`}</span>
							{sameRound.length > 1 && roundNumber > 0 && (
								<>
									<span
										aria-hidden
										className="text-muted-foreground/40 @max-md:hidden"
									>
										·
									</span>
									<RoundSwitcher
										rounds={sameRound}
										batch={batch}
										roundNumber={roundNumber}
										onRound={onRound}
									/>
								</>
							)}
						</div>
					</header>
					<div
						aria-busy={switchingRound || undefined}
						className={cn(
							"grid min-h-[28rem] grid-cols-[19rem_minmax(0,1fr)] transition-opacity duration-150 @max-4xl:grid-cols-1",
							switchingRound && "opacity-70",
						)}
					>
						<div className="min-w-0 py-2.5 @max-4xl:hidden">
							<ModelRunsList models={models} picked={picked} onPick={onPick} />
						</div>
						<div className="min-w-0 border-l bg-muted/20 @max-4xl:border-l-0">
							{picked === null ? (
								<p className="p-5 text-muted-foreground text-sm">
									No run of this test landed in this round.
								</p>
							) : (
								<PickedRun id={picked} test={test} />
							)}
						</div>
					</div>
					<RunsDrawer
						open={runsOpen}
						onOpenChange={setRunsOpen}
						models={models}
						picked={picked}
						onPick={(each) => {
							onPick(each);
							setRunsOpen(false);
						}}
					/>
				</div>
			)}
		</section>
	);
}

/** Bordered segmented round stepper whose center label opens a compact dropdown of every round. */
function RoundSwitcher({
	rounds,
	batch,
	roundNumber,
	onRound,
}: {
	rounds: EvalBatch[];
	batch: string;
	roundNumber: number;
	onRound: (batch: string) => void;
}): JSX.Element {
	const prev = rounds[roundNumber - 2];
	const next = rounds[roundNumber];
	return (
		<div className="inline-flex items-center overflow-hidden rounded-lg border bg-card">
			<button
				type="button"
				aria-label="Previous round"
				disabled={prev === undefined}
				onClick={() => prev !== undefined && onRound(prev.id)}
				className="inline-flex size-6.5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
			>
				<ChevronLeftIcon aria-hidden className="size-3.5" />
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label="Choose round"
					className="inline-flex h-6.5 cursor-pointer items-center gap-1 border-x px-2 font-medium text-foreground/90 transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
				>
					<span>
						Round {roundNumber} of {rounds.length}
					</span>
					<ChevronDownIcon
						aria-hidden
						className="size-3 shrink-0 text-muted-foreground"
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuRadioGroup value={batch} onValueChange={onRound}>
						{[...rounds].reverse().map((each, reverseIndex) => {
							const number = rounds.length - reverseIndex;
							return (
								<DropdownMenuRadioItem key={each.id} value={each.id}>
									Round {number}
									{reverseIndex === 0 ? " (latest)" : ""}
								</DropdownMenuRadioItem>
							);
						})}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<button
				type="button"
				aria-label="Next round"
				disabled={next === undefined}
				onClick={() => next !== undefined && onRound(next.id)}
				className="inline-flex size-6.5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent"
			>
				<ChevronRightIcon aria-hidden className="size-3.5" />
			</button>
		</div>
	);
}

/** The left slide-over drawer holding the grouped run list below the split breakpoint. */
function RunsDrawer({
	open,
	onOpenChange,
	models,
	picked,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	models: ModelRuns[];
	picked: string | null;
	onPick: (run: string) => void;
}): JSX.Element {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(19rem,85vw)] flex-col border-r bg-card pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-card-foreground shadow-xl outline-none transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
					<div className="flex items-center justify-between border-b px-4 py-3">
						<DialogPrimitive.Title className="font-medium text-sm">
							Runs
						</DialogPrimitive.Title>
						<DialogPrimitive.Close
							aria-label="Close runs"
							className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<XIcon aria-hidden className="size-4" />
						</DialogPrimitive.Close>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto py-2">
						<ModelRunsList models={models} picked={picked} onPick={onPick} />
					</div>
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function ModelRunsList({
	models,
	picked,
	onPick,
}: {
	models: ModelRuns[];
	picked: string | null;
	onPick: (run: string) => void;
}): JSX.Element {
	return (
		<>
			{models.map((model) => (
				<ModelGroup
					key={model.target.key}
					model={model}
					picked={picked}
					onPick={onPick}
				/>
			))}
		</>
	);
}

function ModelGroup({
	model,
	picked,
	onPick,
}: {
	model: ModelRuns;
	picked: string | null;
	onPick: (run: string) => void;
}): JSX.Element {
	const clean = model.errored === 0 && model.passed === model.graded;
	const [unfolded, setUnfolded] = useState(false);
	const { markAgent, label } = targetDisplay(model.target);
	const folded = clean && !unfolded;
	return (
		<div className="mt-1">
			<div className="flex items-center gap-2 px-3 py-1.5 text-[13.5px]">
				<AgentMark agent={markAgent} className="size-[15px] shrink-0" />
				<span className="min-w-0 flex-1 truncate">{label}</span>
				<span
					className={cn(
						"tabular-nums",
						clean ? "text-muted-foreground" : "font-medium text-destructive",
					)}
				>
					{model.graded > 0
						? `${model.passed}/${model.graded}`
						: `${model.errored} err`}
				</span>
			</div>
			{folded ? (
				<button
					type="button"
					aria-expanded={false}
					onClick={() => setUnfolded(true)}
					className="flex w-full cursor-pointer items-center gap-1 py-1 pl-9 text-left text-muted-foreground text-[12.5px]"
				>
					<ChevronRightIcon aria-hidden className="size-3" />
					{model.cells.length} {model.cells.length === 1 ? "run" : "runs"}{" "}
					passed
					{model.errored > 0 && ` · ${model.errored} errored`}
				</button>
			) : (
				model.cells.map((cell) => (
					<RunRow
						key={cell.repetition}
						cell={cell}
						picked={cell.run !== null && cell.run.id === picked}
						onPick={onPick}
					/>
				))
			)}
		</div>
	);
}

function RunRow({
	cell,
	picked,
	onPick,
}: {
	cell: EvalCell;
	picked: boolean;
	onPick: (run: string) => void;
}): JSX.Element {
	const status = cell.run?.status ?? "pending";
	const meta = [
		cell.run === null ? null : durationLabel(cell.run.milliseconds),
		cell.run?.costUsd == null ? null : `$${cell.run.costUsd.toFixed(2)}`,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<button
			type="button"
			disabled={cell.run === null}
			aria-current={picked || undefined}
			onClick={() => cell.run !== null && onPick(cell.run.id)}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2 border-l-2 py-1.5 pr-3 pl-8 text-left text-[13px] disabled:cursor-default",
				picked
					? "border-foreground bg-muted"
					: "border-transparent hover:bg-muted/50",
			)}
		>
			<span aria-hidden className="w-3.5 shrink-0">
				{status === "pass" ? (
					<CheckIcon className="size-3.5 text-success" />
				) : status === "pending" ? (
					"…"
				) : (
					<XIcon className="size-3.5 text-destructive" />
				)}
			</span>
			<span className="flex-1">Run {cell.repetition + 1}</span>
			<span className="text-muted-foreground text-xs tabular-nums">
				{status === "error" ? "errored" : meta}
			</span>
		</button>
	);
}

function PickedRun({
	id,
	test,
}: {
	id: string;
	test: SpecTestRow | undefined;
}): JSX.Element {
	const [runs, setRuns] = useState<Record<string, EvalDetail>>({});
	const [lastId, setLastId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [openByRun, setOpenByRun] = useState<Record<string, boolean>>({});
	const cached = runs[id] ?? null;
	useEffect(() => {
		setError(null);
		if (cached !== null) {
			setLastId(id);
			return;
		}
		let current = true;
		evalRun(id).then(
			(loaded) => {
				if (!current) {
					return;
				}
				setRuns((prev) => ({ ...prev, [id]: loaded }));
				setLastId(id);
			},
			(failed: unknown) =>
				current &&
				setError(failed instanceof Error ? failed.message : String(failed)),
		);
		return () => {
			current = false;
		};
	}, [id, cached]);
	const run = cached ?? (lastId === null ? null : (runs[lastId] ?? null));
	if (error !== null && run === null) {
		return (
			<p role="alert" className="p-5 text-destructive text-sm">
				{error}
			</p>
		);
	}
	if (run === null) {
		return (
			<p role="status" className="p-5 text-muted-foreground text-sm">
				Reading the run…
			</p>
		);
	}
	const open = openByRun[run.id] ?? startsOpen(run);
	const { markAgent, label } = targetDisplay(run.target);
	const failure: SpecFailureRow | undefined = test?.failures.find((row) =>
		row.failure.runs.includes(run.id),
	);
	const meta = [
		durationLabel(run.milliseconds),
		run.tokens === null ? null : `${(run.tokens / 1000).toFixed(1)}k tokens`,
		run.costUsd === null ? null : `$${run.costUsd.toFixed(2)}`,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="flex flex-col gap-4 p-5">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2.5">
				<AgentMark agent={markAgent} className="size-5 shrink-0" />
				<h3 className="font-semibold text-[17px]">
					{label} · run {run.repetition + 1}
				</h3>
				<span
					className={cn(
						"rounded-full px-2.5 py-0.5 font-medium text-xs",
						run.status === "pass"
							? "bg-success/15 text-emerald-700 dark:text-emerald-400"
							: run.status === "error"
								? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
								: "bg-destructive/15 text-destructive",
					)}
				>
					{run.status === "pass"
						? "passed"
						: run.status === "error"
							? "errored"
							: "failed"}
				</span>
				<span className="flex-1" />
				<span className="text-muted-foreground text-[13px] tabular-nums">
					{meta}
				</span>
			</div>
			<RunConversation
				run={run}
				open={open}
				onOpenChange={(next) =>
					setOpenByRun((prev) => ({ ...prev, [run.id]: next }))
				}
			/>
			<hr />
			<Grading run={run} />
			{run.status !== "pass" && <Diagnosis row={failure} />}
		</div>
	);
}

/** Each check of the run, ✓ or ✕, with a short reason on a ✕. */
function Grading({ run }: { run: EvalDetail }): JSX.Element | null {
	const entries = [
		...run.checks.map((check) => ({
			key: check.id,
			pass: check.pass,
			text: check.about,
			reason: check.error ?? check.step?.observed ?? null,
		})),
		...(run.judge === null
			? []
			: [
					{
						key: "judge",
						pass: run.judge.pass,
						text: run.rubric ?? run.judge.judge ?? "Judge",
						reason: run.judge.reason,
					},
				]),
	];
	if (entries.length === 0) {
		return null;
	}
	return (
		<section aria-label="Grading">
			<h4 className="mb-2 font-semibold text-sm">Grading</h4>
			<ul className="flex flex-col gap-1.5">
				{entries.map((entry) => (
					<li key={entry.key} className="flex items-baseline gap-2 text-sm">
						{entry.pass ? (
							<CheckIcon
								aria-label="Passed"
								className="size-3.5 shrink-0 translate-y-0.5 text-success"
							/>
						) : (
							<XIcon
								aria-label="Failed"
								className="size-3.5 shrink-0 translate-y-0.5 text-destructive"
							/>
						)}
						<span className="min-w-0">
							<Markdown text={entry.text} inline />
							{!entry.pass && entry.reason !== null && (
								<span className="text-muted-foreground">
									{" · "}
									<Markdown text={entry.reason} inline />
								</span>
							)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The eval lead's one-sentence cause of the failure, its chips, and the remedy. */
function Diagnosis({ row }: { row: SpecFailureRow | undefined }): JSX.Element {
	const failure = row?.failure;
	return (
		<section aria-label="Diagnosis">
			<h4 className="mb-2 font-semibold text-sm">Diagnosis</h4>
			<p className="flex flex-wrap items-center gap-2 text-sm">
				{failure?.causes.map((cause) => (
					<CauseChip key={cause} cause={cause} />
				))}
				<span>
					{failure?.why ??
						(failure?.kind === "harness"
							? "Harness error before grading."
							: "Not yet diagnosed.")}
				</span>
			</p>
			{failure?.remedy != null && (
				<p
					className={cn(
						"mt-3 flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm",
						failure.remedy.state === "applied"
							? "border border-success/50 bg-success/10"
							: "border border-success/50 border-dashed",
					)}
				>
					<WrenchIcon aria-hidden className="size-4 shrink-0 text-success" />
					<span className="min-w-0">
						<b className="font-semibold text-emerald-700 dark:text-emerald-400">
							{failure.remedy.state === "applied"
								? "Applied remedy"
								: "Proposed remedy"}
						</b>
						{" · "}
						{failure.remedy.text}
					</span>
				</p>
			)}
		</section>
	);
}
