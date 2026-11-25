import type {
	Cause,
	EvalDetail,
	EvalGrid,
	EvalScenario,
} from "@splates/server/evals/browser";
import { ChevronRightIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { evalRun } from "./api";
import {
	CheckedByCode,
	distinctJudges,
	type JudgeDisplay,
	JudgedBy,
} from "./eval-judge";
import {
	buildFailureTimeline,
	failureGrader,
	formatRunNumbers,
	remediesSummary,
	type SpecFailureRow,
	type SpecTestRow,
	summarizeTests,
	targetDisplay,
} from "./eval-spec-data";
import { Markdown } from "./markdown";

export { doneAsideText, targetDisplay } from "./eval-spec-data";

const CAUSE_TONE: Record<Cause, string> = {
	skill:
		"bg-[#ede9fe] text-[#5b21b6] dark:bg-violet-500/20 dark:text-violet-300",
	judge: "bg-[#dbeafe] text-[#1e40af] dark:bg-blue-500/20 dark:text-blue-300",
	harness: "bg-muted text-muted-foreground",
	eval: "bg-[#fef3c7] text-[#92400e] dark:bg-amber-500/20 dark:text-amber-300",
};

/**
 * The done state of an eval card: summary line, flat list of spec rows
 * (no group labels), each opening to Prompt, Results by model, collapsible
 * failure rows with step timeline, diagnosis and remedy, plus the footer.
 */
export function EvalSpecResults({
	grid,
	scenarios = [],
	skill,
}: {
	grid: EvalGrid;
	scenarios?: readonly EvalScenario[];
	skill?: string;
}): JSX.Element {
	const tests = useMemo(
		() => summarizeTests(grid, scenarios),
		[grid, scenarios],
	);
	const [openTests, setOpenTests] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [details, setDetails] = useState<Record<string, EvalDetail>>({});

	const loadDetail = (runId: string): void => {
		if (runId === "" || details[runId] !== undefined) {
			return;
		}
		void evalRun(runId).then(
			(loaded) =>
				setDetails((prev) =>
					prev[runId] !== undefined ? prev : { ...prev, [runId]: loaded },
				),
			() => undefined,
		);
	};

	const toggleTest = (test: SpecTestRow): void => {
		setOpenTests((prev) => {
			const next = new Set(prev);
			if (next.has(test.id)) {
				next.delete(test.id);
			} else {
				next.add(test.id);
				if (test.prompt === null && test.sampleRunId !== null) {
					loadDetail(test.sampleRunId);
				}
			}
			return next;
		});
	};

	const subject = grid.skill ?? skill ?? "Evals";
	const failingCount = tests.filter((test) => test.failing).length;
	const passingCount = tests.length - failingCount;
	const remedies = remediesSummary(tests);

	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
				<span className="font-semibold text-sm">{subject}</span>
				{failingCount > 0 && (
					<span className="inline-flex items-center rounded-full bg-destructive/12 px-2 py-px font-medium text-[11px] text-destructive leading-[18px]">
						{failingCount} failing
					</span>
				)}
				{passingCount > 0 && (
					<span className="inline-flex items-center rounded-full bg-success/15 px-2 py-px font-medium text-[11px] text-emerald-700 leading-[18px] dark:text-emerald-400">
						{passingCount} passing
					</span>
				)}
			</div>
			<div className="py-1">
				{tests.map((test) => {
					const isOpen = openTests.has(test.id);
					return (
						<div key={test.id}>
							<button
								type="button"
								aria-expanded={isOpen}
								onClick={() => toggleTest(test)}
								className={cn(
									"flex w-full cursor-pointer items-center gap-2.5 border-border/60 border-t px-4 py-[9px] text-left text-sm transition-colors hover:bg-muted/30",
									isOpen && "bg-muted/30",
								)}
							>
								<ChevronRightIcon
									aria-hidden
									className={cn(
										"size-4 shrink-0 text-muted-foreground transition-transform duration-150",
										isOpen && "rotate-90",
									)}
								/>
								<span
									aria-hidden
									className={cn(
										"w-3.5 shrink-0 text-center font-bold",
										test.failing ? "text-destructive" : "text-success",
									)}
								>
									{test.failing ? "✕" : "✓"}
								</span>
								<Markdown
									text={test.sentence}
									inline
									unlinked
									className={cn("flex-1", isOpen && "font-medium")}
								/>
								{test.causes.length > 0 && (
									<span className="flex shrink-0 gap-1">
										{test.causes.map((cause) => (
											<CauseChip key={cause} cause={cause} />
										))}
									</span>
								)}
								<span className="shrink-0 text-muted-foreground text-[12.5px] tabular-nums whitespace-nowrap">
									{test.passRate === null ? "-" : `${test.passRate}%`}
								</span>
							</button>
							{isOpen && (
								<TestDetail
									test={test}
									batchId={grid.id}
									details={details}
									onNeedDetail={loadDetail}
								/>
							)}
						</div>
					);
				})}
			</div>
			{(remedies !== "" || (grid.id !== "" && tests.length > 0)) && (
				<div className="rule-t flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 @max-md:[&>a]:h-11 @max-md:[&>a]:flex-1">
					{remedies !== "" && (
						<span className="mr-auto text-muted-foreground text-xs">
							{remedies}
						</span>
					)}
					{grid.id !== "" && tests.length > 0 && (
						<a
							href={testAddress(grid.id, landingTest(tests))}
							className={buttonVariants({ size: "sm" })}
						>
							View test results ›
						</a>
					)}
				</div>
			)}
		</div>
	);
}

/** A cause pill (`skill`, `judge`, `harness`, `eval`). */
export function CauseChip({ cause }: { cause: Cause }): JSX.Element {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-[7px] py-px font-medium text-[11px] leading-[18px] whitespace-nowrap",
				CAUSE_TONE[cause],
			)}
		>
			{cause}
		</span>
	);
}

function TestDetail({
	test,
	batchId,
	details,
	onNeedDetail,
}: {
	test: SpecTestRow;
	batchId: string;
	details: Record<string, EvalDetail>;
	onNeedDetail: (runId: string) => void;
}): JSX.Element {
	const prompt =
		test.prompt ??
		(test.sampleRunId === null
			? null
			: (details[test.sampleRunId]?.input ?? null));

	const judges = testJudges(test, details);

	return (
		<div className="bg-muted/30 px-4 pt-1 pb-4 pl-[58px] @max-md:pl-8">
			{prompt !== null && prompt !== "" && (
				<>
					<div className="mt-2 mb-1 font-semibold text-[12.5px] text-foreground">
						Prompt
					</div>
					<div className="border-border border-l-2 pl-2.5 text-[13px] text-foreground/88">
						“{prompt}”
					</div>
				</>
			)}
			<div className="mt-3.5 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-[12.5px] text-foreground">
				Results
				{judges.length > 0 ? (
					<JudgedBy
						judges={judges}
						lead="· Judged by"
						className="font-normal"
					/>
				) : (
					test.judged === false && <CheckedByCode className="font-normal" />
				)}
			</div>
			<div className="flex flex-wrap gap-1.5">
				{test.targets.map((entry) => {
					const { markAgent, label } = targetDisplay(entry.target);
					// A model run at more than one skill revision shows once per revision, so say which.
					const repeated =
						test.targets.filter(
							(other) => targetDisplay(other.target).label === label,
						).length > 1;
					const version =
						entry.target.skill !== null
							? `baseline @${entry.target.skill}`
							: repeated
								? "current"
								: null;
					return (
						<span
							key={entry.target.key}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full border py-[3px] pr-[9px] pl-[7px] text-[12.5px]",
								entry.bad
									? "border-destructive/45 bg-destructive/[0.06]"
									: "border-border bg-card",
							)}
						>
							<AgentMark agent={markAgent} className="size-[15px] shrink-0" />
							<span>{label}</span>
							{version !== null && (
								<span className="rounded bg-muted px-1 text-[11px] text-muted-foreground">
									{version}
								</span>
							)}
							<span
								className={cn(
									"tabular-nums",
									entry.bad
										? "font-medium text-destructive"
										: "text-muted-foreground",
								)}
							>
								{entry.graded > 0
									? `${entry.passed}/${entry.graded}`
									: entry.errored > 0
										? `${entry.errored} err`
										: "0/0"}
							</span>
						</span>
					);
				})}
			</div>
			{test.failures.length > 0 && (
				<>
					<div className="mt-3.5 mb-1.5 font-semibold text-[12.5px] text-foreground">
						Where it failed
						<span className="ml-1.5 font-normal text-muted-foreground">
							{test.failures.length}{" "}
							{test.failures.length === 1 ? "failure" : "failures"}
						</span>
					</div>
					<div>
						{test.failures.map((row) => (
							<FailureRow
								judgeWith={test.judgeWith}
								key={`${row.target.key}:${row.failure.kind}:${row.failure.check ?? ""}:${row.failure.runs.join(",")}`}
								row={row}
								detail={
									row.failure.runs[0] === undefined
										? undefined
										: details[row.failure.runs[0]]
								}
								onNeedDetail={onNeedDetail}
							/>
						))}
					</div>
				</>
			)}
			{batchId !== "" && (
				<div className="mt-3">
					<a
						href={testAddress(batchId, test)}
						className="text-info text-[12.5px] hover:underline"
					>
						All {test.totalRuns} {test.totalRuns === 1 ? "run" : "runs"} on the
						Evals page ›
					</a>
				</div>
			)}
		</div>
	);
}

/**
 * Who judged a test's runs: each judge the opened runs' verdicts name, or,
 * with none opened that says, the judge the scenario names.
 */
function testJudges(
	test: SpecTestRow,
	details: Record<string, EvalDetail>,
): JudgeDisplay[] {
	if (test.judged === false) {
		return [];
	}
	const recorded = Object.values(details)
		.filter((detail) => detail.scenario === test.id)
		.map((detail) => detail.judge?.judge);
	const judges = distinctJudges(recorded);
	return judges.length > 0 ? judges : distinctJudges([test.judgeWith]);
}

function FailureRow({
	row,
	detail,
	judgeWith,
	onNeedDetail,
}: {
	row: SpecFailureRow;
	/** The judge the scenario names, for a run whose verdict does not say who judged. */
	judgeWith: string | null;
	detail: EvalDetail | undefined;
	onNeedDetail: (runId: string) => void;
}): JSX.Element {
	// Every failure row starts collapsed.
	const [open, setOpen] = useState(false);
	const firstRunId = row.failure.runs[0] ?? "";
	const { markAgent, label } = targetDisplay(row.target);
	const summary =
		row.failure.why ??
		(row.failure.kind === "harness"
			? "Harness error before grading."
			: "Not yet diagnosed.");

	useEffect(() => {
		if (open && detail === undefined && firstRunId !== "") {
			onNeedDetail(firstRunId);
		}
	}, [open, detail, firstRunId, onNeedDetail]);

	const steps = useMemo(
		() =>
			detail === undefined ? null : buildFailureTimeline(detail, row.failure),
		[detail, row.failure],
	);
	const failedStep = steps?.find((step) => step.failed);
	const want = failedStep?.expected;
	const got = failedStep?.got;
	const fix = row.failure.remedy;
	const hasSummaryCard = Boolean(want || got || fix);
	const grader =
		detail === undefined ? null : failureGrader(detail, row.failure);
	const judges =
		grader === "judge"
			? distinctJudges([detail?.judge?.judge ?? judgeWith])
			: [];

	return (
		<div className="border-border/60 border-t first:border-t-0">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((was) => !was)}
				className="flex w-full cursor-pointer items-center gap-2 py-2 text-left text-[13px]"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
						open && "rotate-90",
					)}
				/>
				<span
					aria-hidden
					className="w-3 shrink-0 text-center font-bold text-destructive"
				>
					✕
				</span>
				<AgentMark agent={markAgent} className="size-[15px] shrink-0" />
				<span className="shrink-0">{label}</span>
				<span className="shrink-0 text-muted-foreground">
					{formatRunNumbers(row.runNumbers, row.failure.runs.length)}
				</span>
				{!open && (
					<span className="ml-1.5 min-w-0 flex-1 truncate text-muted-foreground">
						{summary}
					</span>
				)}
				{row.failure.causes.length > 0 && (
					<span className="ml-auto flex shrink-0 gap-1">
						{row.failure.causes.map((cause) => (
							<CauseChip key={cause} cause={cause} />
						))}
					</span>
				)}
			</button>
			{open && (
				<div className="pt-0.5 pb-3 pl-[22px]">
					{row.runNumbers[0] !== undefined && (
						<div className="mt-0.5 mb-1.5 text-muted-foreground text-xs">
							Run {row.runNumbers[0]}
						</div>
					)}
					{steps === null ? (
						<p className="mb-2 text-muted-foreground text-xs">Loading run…</p>
					) : (
						<div className="mb-1">
							{steps.map((step, index) => {
								const isLast = index === steps.length - 1;
								return (
									<div
										key={step.key}
										className="relative pb-2.5 pl-6 text-[13px]"
									>
										{!isLast && (
											<span
												aria-hidden
												className="absolute top-[19px] bottom-0 left-[7.5px] w-px bg-border"
											/>
										)}
										<span
											aria-hidden
											className="absolute top-[2px] left-0 flex size-4 items-center justify-center"
										>
											{step.failed ? (
												<CircleXIcon className="size-4 text-destructive" />
											) : (
												<CircleCheckIcon className="size-4 text-success" />
											)}
										</span>
										<div className="flex items-start justify-between gap-2">
											<span className="min-w-0 break-words">{step.label}</span>
											{step.elapsed !== null && (
												<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
													{step.elapsed}
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
					<div className="mt-1 text-[13px]">{summary}</div>
					{hasSummaryCard && (
						<div className="mt-2.5 flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-[12.5px] text-foreground">
							{(judges.length > 0 || grader === "code") && (
								<div className="border-border/60 border-b pb-1.5">
									{judges.length > 0 ? (
										<JudgedBy judges={judges} />
									) : (
										<CheckedByCode />
									)}
								</div>
							)}
							{want && (
								<div className="flex items-baseline gap-2.5">
									<span className="w-9 shrink-0 font-medium text-muted-foreground text-xs">
										Want
									</span>
									<span className="min-w-0 flex-1 break-words">{want}</span>
								</div>
							)}
							{got && (
								<div className="flex items-baseline gap-2.5">
									<span className="w-9 shrink-0 font-medium text-muted-foreground text-xs">
										Got
									</span>
									<span className="min-w-0 flex-1 break-words">{got}</span>
								</div>
							)}
							{fix !== null && (
								<div
									className={cn(
										"flex items-baseline gap-2.5",
										(want || got) && "border-border/60 border-t pt-1.5",
									)}
								>
									<span className="w-9 shrink-0 font-medium text-muted-foreground text-xs">
										Fix
									</span>
									<span className="min-w-0 flex-1 break-words">{fix.text}</span>
									<span
										className={cn(
											"shrink-0 rounded-full px-2 py-px font-medium text-[11px] leading-[18px]",
											fix.state === "applied"
												? "bg-success/15 text-emerald-700 dark:text-emerald-400"
												: "bg-muted text-muted-foreground",
										)}
									>
										{fix.state === "applied" ? "Applied" : "Proposed"}
									</span>
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** The test page of `test` in its batch, landing on its first failing run when one failed. */
export function testAddress(batchId: string, test: SpecTestRow): string {
	const run = test.failures[0]?.failure.runs[0];
	return `#evals/${encodeURIComponent(batchId)}/test/${encodeURIComponent(test.id)}${run === undefined ? "" : `/${encodeURIComponent(run)}`}`;
}

/** The test the card opens: the first failing one, else the first. */
export function landingTest(tests: readonly SpecTestRow[]): SpecTestRow {
	return tests.find((test) => test.failing) ?? (tests[0] as SpecTestRow);
}
