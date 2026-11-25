import type {
	Cause,
	EvalCell,
	EvalDetail,
	EvalFailure,
	EvalGrid,
	EvalScenario,
	EvalStep,
	EvalTarget,
	EvalTestResult,
} from "@splates/server/evals/browser";
import { DEFAULT_PASS } from "@splates/server/evals/browser";
import { checkStep } from "./eval-judgment";

/** One model's results on a test, as the Results pills show it. */
export interface SpecTargetSummary {
	target: EvalTarget;
	passed: number;
	graded: number;
	errored: number;
	bad: boolean;
}

/** One distinct failure group on a test, shown as a flat collapsible row. */
export interface SpecFailureRow {
	target: EvalTarget;
	failure: EvalFailure;
	/** 1-based run numbers (from cell repetition + 1), sorted ascending. */
	runNumbers: number[];
}

/** One test row in the done eval card. */
export interface SpecTestRow {
	id: string;
	sentence: string;
	prompt: string | null;
	passed: number;
	graded: number;
	errored: number;
	/** Rounded percentage (0-100), or null when no runs were graded. */
	passRate: number | null;
	failing: boolean;
	causes: Cause[];
	targets: SpecTargetSummary[];
	failures: SpecFailureRow[];
	totalRuns: number;
	/** First landed run id, used to lazily read the prompt when scenarios did not include it. */
	sampleRunId: string | null;
	/** The judge the scenario names (`judgeWith`), or null when it names none or is unknown here. */
	judgeWith: string | null;
	/** Whether a judge grades the scenario: false for code checks only, null when the scenario is unknown here. */
	judged: boolean | null;
}

/** The agent id for `AgentMark` and the human-readable model label for a target. */
export function targetDisplay(target: EvalTarget): {
	markAgent: string;
	label: string;
} {
	const rawAgent = target.agent.toLowerCase();
	// Gemini models run under Antigravity always show the Antigravity logo.
	const markAgent =
		rawAgent === "antigravity" || rawAgent === "agy" ? "antigravity" : rawAgent;
	const label = formatModelLabel(target.agent, target.model);
	return { markAgent, label };
}

/** One step in the short timeline shown when a failure row is opened. */
export interface FailureTimelineStep {
	key: string;
	label: string;
	elapsed: string | null;
	failed: boolean;
	expected?: string;
	got?: string;
}

/** `targetDisplay` for a target known only by its key, `<agent>/<model>@<effort>` with an optional ` @<revision>`. */
export function targetDisplayOfKey(key: string): {
	markAgent: string;
	label: string;
} {
	const [name = ""] = key.split(" @");
	const slash = name.indexOf("/");
	const agent = slash < 0 ? name : name.slice(0, slash);
	const rest = slash < 0 ? "" : name.slice(slash + 1);
	const at = rest.indexOf("@");
	const model = at < 0 ? rest : rest.slice(0, at);
	return targetDisplay({
		key,
		agent,
		model: model === "" ? null : model,
		effort: at < 0 ? null : rest.slice(at + 1),
		skill: null,
	});
}

/** Formats 1-based run numbers as `run 3`, `runs 4 and 5`, or `runs 4, 5 and 7`. */
export function formatRunNumbers(
	numbers: readonly number[],
	fallbackCount = 0,
): string {
	const unique = [...new Set(numbers)].sort((first, second) => first - second);
	if (unique.length === 0) {
		return fallbackCount <= 1 ? "1 run" : `${fallbackCount} runs`;
	}
	if (unique.length === 1) {
		return `run ${unique[0]}`;
	}
	if (unique.length === 2) {
		return `runs ${unique[0]} and ${unique[1]}`;
	}
	return `runs ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** Header aside for a finished batch: `5 models × 7 runs · $9.40`. */
export function doneAsideText(grid: EvalGrid): string {
	const models = grid.targets.length;
	const reps = Math.max(1, ...grid.grid.map((cell) => cell.repetition + 1));
	const parts = [
		`${models} ${models === 1 ? "model" : "models"} × ${reps} ${reps === 1 ? "run" : "runs"}`,
	];
	if (grid.costUsd !== null && grid.costUsd > 0) {
		parts.push(`$${grid.costUsd.toFixed(2)}`);
	}
	return parts.join(" · ");
}

/** Footer count of proposed and applied remedies across all tests. */
export function remediesSummary(tests: readonly SpecTestRow[]): string {
	let proposed = 0;
	let applied = 0;
	for (const test of tests) {
		for (const row of test.failures) {
			if (row.failure.remedy?.state === "proposed") {
				proposed++;
			} else if (row.failure.remedy?.state === "applied") {
				applied++;
			}
		}
	}
	if (proposed > 0 && applied > 0) {
		return `${proposed} proposed · ${applied} applied`;
	}
	if (proposed > 0) {
		return `${proposed} ${proposed === 1 ? "fix" : "fixes"} proposed`;
	}
	if (applied > 0) {
		return `${applied} ${applied === 1 ? "fix" : "fixes"} applied`;
	}
	return "";
}

/**
 * Turns a batch grid (and optional scenario definitions) into flat spec test
 * rows in plan order, without group labels.
 */
export function summarizeTests(
	grid: EvalGrid,
	scenarios: readonly EvalScenario[] = [],
): SpecTestRow[] {
	const scenarioById = new Map(scenarios.map((each) => [each.id, each]));
	const targetByKey = new Map(grid.targets.map((each) => [each.key, each]));
	const runRepetition = new Map<string, number>();
	const cellsByScenario = new Map<string, EvalCell[]>();
	for (const cell of grid.grid) {
		if (cell.run !== null) {
			runRepetition.set(cell.run.id, cell.repetition + 1);
		}
		cellsByScenario.set(cell.scenario, [
			...(cellsByScenario.get(cell.scenario) ?? []),
			cell,
		]);
	}

	const rawResults: EvalTestResult[] =
		Array.isArray(grid.results) && grid.results.length > 0
			? grid.results
			: fallbackResults(grid.grid);

	const resultsByScenario = new Map<string, EvalTestResult[]>();
	for (const result of rawResults) {
		resultsByScenario.set(result.scenario, [
			...(resultsByScenario.get(result.scenario) ?? []),
			result,
		]);
	}

	const scenarioOrder: string[] = [];
	const seen = new Set<string>();
	for (const cell of grid.grid) {
		if (!seen.has(cell.scenario)) {
			seen.add(cell.scenario);
			scenarioOrder.push(cell.scenario);
		}
	}
	for (const result of rawResults) {
		if (!seen.has(result.scenario)) {
			seen.add(result.scenario);
			scenarioOrder.push(result.scenario);
		}
	}

	return scenarioOrder.map((id) => {
		const cells = cellsByScenario.get(id) ?? [];
		const def = scenarioById.get(id);
		const firstReq =
			cells.find((cell) => cell.requirement !== "")?.requirement ?? "";
		const sentence = def?.about || firstReq || id;
		const prompt = def?.prompt ?? null;
		const results = resultsByScenario.get(id) ?? [];

		const targetOrder = new Map(
			grid.targets.map((target, index) => [target.key, index]),
		);
		const orderedResults = [...results].sort(
			(first, second) =>
				(targetOrder.get(first.target) ?? Number.MAX_SAFE_INTEGER) -
				(targetOrder.get(second.target) ?? Number.MAX_SAFE_INTEGER),
		);

		let passed = 0;
		let graded = 0;
		let errored = 0;
		// The percentage scores the current code only; baseline runs are a comparison.
		let currentPassed = 0;
		let currentGraded = 0;
		const causes: Cause[] = [];
		const targets: SpecTargetSummary[] = [];
		const failures: SpecFailureRow[] = [];

		for (const res of orderedResults) {
			passed += res.passed;
			graded += res.graded;
			errored += res.errored;
			const target = targetByKey.get(res.target) ?? targetFromKey(res.target);
			if (target.skill === null) {
				currentPassed += res.passed;
				currentGraded += res.graded;
			}
			targets.push({
				target,
				passed: res.passed,
				graded: res.graded,
				errored: res.errored,
				bad: res.passed < res.graded || res.errored > 0,
			});
			for (const failure of res.failures) {
				for (const cause of failure.causes) {
					if (!causes.includes(cause)) {
						causes.push(cause);
					}
				}
				const runNumbers = failure.runs
					.map((runId) => runRepetition.get(runId))
					.filter((num): num is number => num !== undefined);
				failures.push({ target, failure, runNumbers });
			}
		}

		const passRate =
			currentGraded > 0
				? Math.round((currentPassed / currentGraded) * 100)
				: null;
		// A test fails once a model's graded runs here put a pass out of reach: more failures than its rule's window allows.
		const rule = def?.pass ?? DEFAULT_PASS;
		const failing =
			graded > 0
				? targets.some(
						(entry) => entry.graded - entry.passed > rule.of - rule.need,
					)
				: errored > 0;
		const sampleRunId =
			orderedResults.find((res) => res.firstFailed !== null)?.firstFailed ??
			cells.find((cell) => cell.run !== null)?.run?.id ??
			null;

		return {
			id,
			sentence,
			prompt,
			passed,
			graded,
			errored,
			passRate,
			failing,
			causes,
			targets,
			failures,
			totalRuns: cells.length || graded + errored,
			sampleRunId,
			judgeWith: def?.judgeWith ?? null,
			judged: def?.judge === undefined ? null : def.judge !== null,
		};
	});
}

/**
 * What graded the failure the want/got card shows, chosen as
 * `buildFailureTimeline` picks its Want: the judge, a code check, or neither
 * for a harness error.
 */
export function failureGrader(
	detail: EvalDetail,
	failure: EvalFailure,
): "judge" | "code" | null {
	if (detail.harness !== undefined) {
		return null;
	}
	if (failure.check === "judge") {
		return "judge";
	}
	const failedCheck =
		(failure.check !== null
			? detail.checks.find((check) => check.id === failure.check)
			: undefined) ?? detail.checks.find((check) => !check.pass);
	if (failedCheck !== undefined) {
		return "code";
	}
	return detail.judge?.pass === false ? "judge" : null;
}

/** Builds the short step timeline for an opened failure row from its run detail and diagnosis. */
export function buildFailureTimeline(
	detail: EvalDetail,
	failure: EvalFailure,
): FailureTimelineStep[] {
	const failedCheck =
		(failure.check !== null && failure.check !== "judge"
			? detail.checks.find((check) => check.id === failure.check)
			: undefined) ?? detail.checks.find((check) => !check.pass);
	const expected =
		failure.check === "judge"
			? (detail.rubric ?? undefined)
			: (failedCheck?.about ??
				(detail.judge?.pass === false
					? (detail.rubric ?? undefined)
					: undefined));
	const got =
		failure.did?.text ??
		failedCheck?.step?.observed ??
		failedCheck?.error ??
		(detail.judge?.pass === false ? detail.judge.reason : undefined) ??
		detail.error ??
		detail.reason;

	if (detail.harness !== undefined) {
		return [
			{
				key: "harness",
				label:
					detail.harness === "skipped"
						? "Skipped after a harness error"
						: "Never reached the agent",
				elapsed: formatStepTime(detail.milliseconds),
				failed: true,
				expected,
				got: detail.error ?? detail.reason ?? got,
			},
		];
	}

	const failedIndex =
		failure.did?.step ??
		(failedCheck === undefined
			? undefined
			: checkStep(failedCheck, detail)?.index);

	const steps: FailureTimelineStep[] = [];
	let elapsedMs = 0;
	detail.transcript.forEach((step, index) => {
		if (step.kind === "tool") {
			elapsedMs += step.milliseconds ?? 0;
		}
		const label = summarizeStep(step);
		if (label === null) {
			return;
		}
		const isFailed = failedIndex === index;
		steps.push({
			key: `step-${index}`,
			label,
			elapsed: elapsedMs > 0 ? formatStepTime(elapsedMs) : null,
			failed: isFailed,
			...(isFailed ? { expected, got } : {}),
		});
	});

	if (detail.reply.trim() !== "") {
		const isFailed = !steps.some((step) => step.failed);
		const trimmed = detail.reply.trim().replace(/\s+/gu, " ");
		const quoted = trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
		steps.push({
			key: "reply",
			label: `Replied: “${quoted}”`,
			elapsed:
				detail.milliseconds > 0 ? formatStepTime(detail.milliseconds) : null,
			failed: isFailed,
			...(isFailed ? { expected, got } : {}),
		});
	}

	if (steps.length === 0) {
		steps.push({
			key: "failed",
			label: detail.error ?? detail.reason ?? "Run failed",
			elapsed:
				detail.milliseconds > 0 ? formatStepTime(detail.milliseconds) : null,
			failed: true,
			expected,
			got,
		});
	} else if (!steps.some((step) => step.failed)) {
		const last = steps[steps.length - 1] as FailureTimelineStep;
		last.failed = true;
		last.expected = expected;
		last.got = got;
	}

	return steps;
}

export function formatModelLabel(agent: string, model: string | null): string {
	const trimmed = model?.trim() ?? "";
	if (trimmed === "") {
		return capitalizeWord(agent);
	}
	const claude = /^claude-(sonnet|opus|haiku)-(\d+)-(\d+)(?:-\d+)?$/iu.exec(
		trimmed,
	);
	if (claude !== null) {
		return `${capitalizeWord(claude[1] ?? "")} ${claude[2]}.${claude[3]}`;
	}
	const claudeShort =
		/^(sonnet|opus|haiku)(?:[- ](\d+)(?:[.-](\d+))?)?$/iu.exec(trimmed);
	if (claudeShort !== null) {
		const name = capitalizeWord(claudeShort[1] ?? "");
		if (claudeShort[2] === undefined) {
			return name;
		}
		return claudeShort[3] === undefined
			? `${name} ${claudeShort[2]}`
			: `${name} ${claudeShort[2]}.${claudeShort[3]}`;
	}
	const gemini = /^gemini-([\w.-]+)$/iu.exec(trimmed);
	if (gemini !== null) {
		return `Gemini ${(gemini[1] ?? "")
			.split("-")
			.map(capitalizeWord)
			.join(" ")}`;
	}
	if (trimmed.includes("/")) {
		// A provider-prefixed id such as `kimi-code/k3.1-pro` reads as its model.
		return (trimmed.split("/").pop() ?? trimmed)
			.split("-")
			.map(capitalizeWord)
			.join(" ");
	}
	return trimmed;
}

function capitalizeWord(word: string): string {
	return word === "" ? "" : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

function fallbackResults(cells: readonly EvalCell[]): EvalTestResult[] {
	const grouped = new Map<string, EvalCell[]>();
	for (const cell of cells) {
		if (cell.run === null) {
			continue;
		}
		const key = `${cell.scenario}\n${cell.target}`;
		grouped.set(key, [...(grouped.get(key) ?? []), cell]);
	}
	return [...grouped.values()].map((group) => {
		const sorted = [...group].sort(
			(first, second) => first.repetition - second.repetition,
		);
		const first = sorted[0] as EvalCell;
		const passed = sorted.filter((cell) => cell.run?.status === "pass").length;
		const failed = sorted.filter((cell) => cell.run?.status === "fail");
		const errored = sorted.filter((cell) => cell.run?.status === "error");
		const failures: EvalFailure[] = [];
		if (errored.length > 0) {
			failures.push({
				kind: "harness",
				runs: errored.map((cell) => cell.run?.id ?? ""),
				check: null,
				causes: ["harness"],
				why: null,
				did: null,
				remedy: null,
			});
		}
		if (failed.length > 0) {
			failures.push({
				kind: "undiagnosed",
				runs: failed.map((cell) => cell.run?.id ?? ""),
				check: null,
				causes: [],
				why: null,
				did: null,
				remedy: null,
			});
		}
		return {
			scenario: first.scenario,
			target: first.target,
			passed,
			graded: passed + failed.length,
			errored: errored.length,
			firstFailed: failed[0]?.run?.id ?? errored[0]?.run?.id ?? null,
			failures,
		};
	});
}

function targetFromKey(key: string): EvalTarget {
	const slash = key.indexOf("/");
	if (slash === -1) {
		return { key, agent: key, model: null, effort: null, skill: null };
	}
	return {
		key,
		agent: key.slice(0, slash),
		model: key.slice(slash + 1),
		effort: null,
		skill: null,
	};
}

function summarizeStep(step: EvalStep): string | null {
	if (step.kind === "tool") {
		const arg = shortToolArg(step.input);
		return arg === "" ? step.name : `${step.name} ${arg}`;
	}
	if (step.kind === "text" && step.text.trim() !== "") {
		const text = step.text.trim().replace(/\s+/gu, " ");
		return text.length > 100 ? `${text.slice(0, 97)}…` : text;
	}
	return null;
}

function shortToolArg(input: string): string {
	try {
		const parsed = JSON.parse(input) as unknown;
		if (parsed !== null && typeof parsed === "object") {
			const record = parsed as Record<string, unknown>;
			const preferred =
				record.file_path ??
				record.path ??
				record.command ??
				record.pattern ??
				Object.values(record)[0];
			if (typeof preferred === "string") {
				return preferred.length > 60 ? `${preferred.slice(0, 57)}…` : preferred;
			}
		}
	} catch {
		// fall through to raw input
	}
	const plain = input.trim().replace(/\s+/gu, " ");
	return plain.length > 60 ? `${plain.slice(0, 57)}…` : plain;
}

function formatStepTime(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
