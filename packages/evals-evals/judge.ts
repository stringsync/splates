import { withoutMedia } from "./media";
import type { Step } from "./scenario";

/** What the judge decided, and why. */
export interface Verdict {
	pass: boolean;
	reason: string;
	usd: number | null;
	/** Who judged, as `judgeName` writes it, when known. */
	judge?: string;
}

/** The Claude model, and its effort, that judges a run. */
export interface JudgePick {
	model: string;
	effort?: string;
}

/** The judge when neither the run nor the scenario names one. */
export const DEFAULT_JUDGE: JudgePick = { model: "sonnet" };

/** `claude:opus@high` (or `claude:opus`) as a judge pick; only Claude judges. */
export function judgePickOf(text: string): JudgePick {
	const [, agent, model, effort] =
		/^([^:@]+):([^@]+)(?:@(.+))?$/.exec(text) ?? [];
	if (agent !== "claude" || model === undefined) {
		throw new Error(
			`no judge ${text}; a judge is claude:<model>[@<effort>], like claude:opus@high`,
		);
	}
	return { model, ...(effort === undefined ? {} : { effort }) };
}

/** `pick` as `judgePickOf` reads it. */
export function judgeName(pick: JudgePick): string {
	return `claude:${pick.model}${pick.effort === undefined ? "" : `@${pick.effort}`}`;
}

/** The judge a scenario is graded by: its own, else the run's, else the default. */
export function judgeFor(
	scenario: { judgeWith?: string },
	run?: JudgePick,
): JudgePick {
	if (scenario.judgeWith !== undefined) {
		return judgePickOf(scenario.judgeWith);
	}
	return run ?? DEFAULT_JUDGE;
}

/** Asks the judge, a Claude model with no tools, and reads its verdict. */
export async function judge(
	prompt: string,
	env: Record<string, string>,
	pick: JudgePick = DEFAULT_JUDGE,
): Promise<Verdict> {
	const child = Bun.spawn(
		[
			"claude",
			"--print",
			"--output-format",
			"json",
			"--model",
			pick.model,
			...(pick.effort === undefined ? [] : ["--effort", pick.effort]),
			"--tools",
			"",
			"--setting-sources",
			"",
			"--strict-mcp-config",
			"--mcp-config",
			'{"mcpServers":{}}',
			"--no-session-persistence",
			"--max-turns",
			"1",
		],
		{ env, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) {
		throw new Error(
			`the judge exited ${code}: ${stderr.trim() || stdout.trim()}`,
		);
	}
	const answer = JSON.parse(stdout) as {
		result?: unknown;
		total_cost_usd?: unknown;
	};
	return {
		...verdictOf(
			typeof answer.result === "string" ? answer.result : "",
			typeof answer.total_cost_usd === "number" ? answer.total_cost_usd : null,
		),
		judge: judgeName(pick),
	};
}

/** Text budget shared across steps so a large result cannot hide earlier actions. */
const READS = 60_000;

/** What the judge is asked: the requirement and rubric, then the run. */
export function judgePrompt(ask: {
	requirement: string;
	rubric: string;
	message: string;
	transcript: readonly Step[];
	reply: string;
}): string {
	const perStep = Math.max(
		1,
		Math.floor(READS / Math.max(1, ask.transcript.length)),
	);
	const steps = ask.transcript
		.map((step) => {
			const text =
				step.kind === "text"
					? `AGENT: ${step.text}`
					: `TOOL ${step.name}: ${withoutMedia(step.input)}${step.output === null ? "" : `\n→ ${withoutMedia(step.output)}`}`;
			if (text.length <= perStep) {
				return text;
			}
			return `${text.slice(0, Math.floor(perStep / 2))}\n[step truncated]\n${text.slice(-Math.floor(perStep / 2))}`;
		})
		.join("\n\n");
	return `You grade one run of an AI coding agent that was given a skill telling it how to work. Judge only what the requirement and rubric ask, from what the agent did; ignore everything else. Inline media bytes are omitted, but their tool calls and paths remain evidence of inspection. Truncated step content is unavailable evidence, not proof that an action never happened.

Requirement of the skill: ${ask.requirement}

What to decide: ${ask.rubric}

The person's message to the agent:
${ask.message}

What the agent did, in order:
${steps}

The agent's final reply:
${ask.reply}

Answer with JSON alone, no other words: {"pass": true or false, "reason": "one or two sentences on what decided it"}`;
}

/** Parses JSON, retrying with stray backslash escapes (like \\`) read as the character they precede. */
function parseLenient(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return JSON.parse(
			json.replace(/\\(["\\/bfnrtu])|\\/g, (_, valid?: string) =>
				valid === undefined ? "" : `\\${valid}`,
			),
		);
	}
}

/** Reads the judge's answer; a reply it cannot read fails, saying so. */
export function verdictOf(text: string, usd: number | null): Verdict {
	const found = /\{[\s\S]*\}/.exec(text);
	try {
		const parsed = parseLenient(found?.[0] ?? "") as {
			pass?: unknown;
			reason?: unknown;
		};
		if (typeof parsed.pass === "boolean") {
			return {
				pass: parsed.pass,
				reason: typeof parsed.reason === "string" ? parsed.reason : "",
				usd,
			};
		}
	} catch {}
	return {
		pass: false,
		reason: `the judge's answer was unreadable: ${text}`,
		usd,
	};
}
