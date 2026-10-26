import type { Step } from "./scenario";

/** What the judge decided, and why. */
export interface Verdict {
	pass: boolean;
	reason: string;
	usd: number | null;
}

/** Asks the judge, Claude's small model with no tools, and reads its verdict. */
export async function judge(
	prompt: string,
	env: Record<string, string>,
): Promise<Verdict> {
	const child = Bun.spawn(
		[
			"claude",
			"--print",
			"--output-format",
			"json",
			"--model",
			JUDGE_MODEL,
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
	return verdictOf(
		typeof answer.result === "string" ? answer.result : "",
		typeof answer.total_cost_usd === "number" ? answer.total_cost_usd : null,
	);
}

/** How much of a transcript the judge reads, from its end when it runs longer. */
const READS = 60_000;

/** The judge's model: small, since it only reads and decides. */
export const JUDGE_MODEL = "haiku";

/** What the judge is asked: the requirement and rubric, then the run. */
export function judgePrompt(ask: {
	requirement: string;
	rubric: string;
	message: string;
	transcript: readonly Step[];
	reply: string;
}): string {
	const steps = ask.transcript
		.map((step) =>
			step.kind === "text"
				? `AGENT: ${step.text}`
				: `TOOL ${step.name}: ${step.input}${step.output === null ? "" : `\n→ ${step.output}`}`,
		)
		.join("\n\n");
	return `You grade one run of an AI coding agent that was given a skill telling it how to work. Judge only what the requirement and rubric ask, from what the agent did; ignore everything else.

Requirement of the skill: ${ask.requirement}

What to decide: ${ask.rubric}

The person's message to the agent:
${ask.message}

What the agent did, in order:
${steps.length > READS ? `…${steps.slice(-READS)}` : steps}

The agent's final reply:
${ask.reply}

Answer with JSON alone, no other words: {"pass": true or false, "reason": "one or two sentences on what decided it"}`;
}

/** Reads the judge's answer; a reply it cannot read fails, saying so. */
export function verdictOf(text: string, usd: number | null): Verdict {
	const found = /\{[\s\S]*\}/.exec(text);
	try {
		const parsed = JSON.parse(found?.[0] ?? "") as {
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
