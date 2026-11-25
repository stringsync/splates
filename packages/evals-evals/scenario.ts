import type { AgentRun } from "./agents";
import type { EvalCheck, EvalCheckStep, EvalStep } from "./contract";

/**
 * One eval: a repo seeded for it, the person's message, the skill requirement
 * it checks in words, and how the outcome is graded: code checks for what is
 * concrete, a judge's rubric for behaviour.
 */
export interface Scenario {
	/** `aspect/name`, or a stable hidden key for specs. */
	id: string;
	aspect: string;
	/** What the skill asks of the agent here, in words; the judge reads it on legacy scenarios. */
	requirement: string;
	/** Spec sentence from `it(...)`, when written as a spec. */
	sentence?: string;
	/** Enclosing `describe(...)` group path, outermost first, when written as a spec. */
	groups?: readonly string[];
	/** Optional detailed context for the judge; falls back to `sentence` plus its checks when absent. */
	detail?: string;
	/** One line on the repo and state the scenario starts from, backticks as code. */
	environment?: string;
	/** A sketched good reply, shown beside the spec; `does` is plain English, backticks as code. */
	example?: readonly ExampleStep[];
	/** Adds what the scenario needs to the minimal repo, before the seed commit. */
	seed?: (repo: Repo) => Promise<void>;
	/** Leaves uncommitted work in the repo, after the seed commit. */
	change?: (repo: Repo) => Promise<void>;
	/** What the person says to the agent. */
	message: string;
	checks?: Check[];
	/** What the judge decides from the transcript; no judge when absent. */
	judge?: string;
	/** The judge for this scenario's rubric, as `claude:<model>[@<effort>]`, over the run's. */
	judgeWith?: string;
	limits?: Limits;
	/** Which scenarios run first when a budget cannot run them all; unset is `normal`. */
	priority?: Priority;
	/** Off by default. On opencode, a turn that ends without a final answer is resumed, up to `turns` more times. */
	followUp?: ScenarioFollowUp;
}

/** How soon a scenario runs when a budget cannot run them all. */
export type Priority = "high" | "normal" | "low";

/** One step of a sketched good reply: a tool call or a text reply. */
export type ExampleStep =
	| { kind: "tool"; name: string; input?: string; does?: string }
	| { kind: "text"; text: string };

/** What the judge reads as the skill requirement: `detail`, else `sentence` plus its checks, else `requirement`. */
export function judgeDetailOf(scenario: Scenario): string {
	if (scenario.detail !== undefined && scenario.detail.trim() !== "") {
		return scenario.detail;
	}
	if (scenario.sentence !== undefined) {
		const checks = (scenario.checks ?? [])
			.map((each) => each.about.trim())
			.filter((each) => each !== "");
		if (checks.length === 0) {
			return scenario.sentence;
		}
		return `${scenario.sentence}\nChecks:\n${checks.map((each) => `- ${each}`).join("\n")}`;
	}
	return scenario.requirement;
}

/** The human-readable title of a scenario: its spec sentence when present, else its requirement. */
export function specTitleOf(scenario: Scenario): string {
	return scenario.sentence ?? scenario.requirement;
}

export interface ScenarioFollowUp {
	turns: number;
	/** Whether the run so far holds its final answer; by default, when it has a reply. */
	done?: (run: AgentRun) => boolean;
}

/** A question of the outcome, optionally citing a transcript step on failure. */
export interface Check {
	id: string;
	/** What it checks, in words, shown beside its result. */
	about: string;
	/** True for a check that needs a task board or server: regrading cannot re-run it, so it keeps the result it had. */
	live?: boolean;
	test: (outcome: Outcome) => CheckVerdict | Promise<CheckVerdict>;
}

export type CheckVerdict =
	| boolean
	| { pass: true }
	| { pass: false; step?: EvalCheckStep };

/** Evaluate a check against the same full transcript that will be saved. */
export async function evaluateCheck(
	check: Check,
	outcome: Outcome,
): Promise<EvalCheck> {
	const verdict = await check.test(outcome);
	const pass = typeof verdict === "boolean" ? verdict : verdict.pass;
	const result = { id: check.id, about: check.about, pass };
	const step =
		typeof verdict !== "boolean" && !verdict.pass ? verdict.step : undefined;
	if (
		step !== undefined &&
		Number.isInteger(step.index) &&
		step.index >= 0 &&
		step.index < outcome.transcript.length
	) {
		return { ...result, step };
	}
	return result;
}

/** How far one run may go before it is stopped. */
export interface Limits {
	turns?: number;
	minutes?: number;
	/** Dollars, where the agent can cap its own spend. */
	usd?: number;
}

/** The repo a scenario seeds, and runs shell commands in. */
export interface Repo {
	dir: string;
	write(path: string, text: string): Promise<void>;
	/** Runs `argv` in the repo with the run's environment; throws when it fails. */
	run(argv: string[]): Promise<string>;
}

/** One step of what the agent did: something it said, or a tool it called and what came back. */
export type Step = EvalStep;

/** What a run left: the agent's words and steps, and the repo as it ended. */
export interface Outcome {
	reply: string;
	transcript: Step[];
	/** Each shell command the agent ran, as it wrote it. */
	commands: string[];
	repo: Repo;
}
