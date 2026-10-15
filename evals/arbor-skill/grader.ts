import { createHash } from "node:crypto";
import { $ } from "bun";
import type { EndRepo } from "./fixture";
import type { RunLog, Usage } from "./transcript";

/**
 * Has a model grade one run on the items that take judgment, through
 * `claude -p`, the code checks having taken everything a program can tell.
 */
export async function grade(
	log: RunLog,
	end: EndRepo,
	rubric: string[],
	opts: GradeOptions,
): Promise<Grade> {
	const prompt = `You grade one run of a coding agent that was following the arbor skill. Judge only from the transcript and the end state below. For each rubric item, decide pass, fail, or n/a, strictly by its wording.

Rubric (the id is the text before the first colon):
${rubric.map((item) => `- ${item}`).join("\n")}

Reply with only a JSON object: {"<id>": {"verdict": "pass"|"fail"|"n/a", "why": "<one short sentence of evidence>"}, ...}

<transcript>
${log.text}
</transcript>

<end-state>
${JSON.stringify(end, null, 1)}
</end-state>`;
	const out =
		await $`claude -p --model ${opts.model} --output-format json --setting-sources project --strict-mcp-config < ${new Response(prompt)}`
			.env({ ...process.env, CLAUDECODE: undefined })
			.quiet();
	const reply = JSON.parse(out.stdout.toString()) as {
		result?: string;
		total_cost_usd?: number;
		usage?: Record<string, number>;
	};
	const text = reply.result ?? "";
	const items = JSON.parse(
		text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
	) as Grade["items"];
	const usage = reply.usage ?? {};
	return {
		model: opts.model,
		rubric: rubricHash(rubric),
		items,
		usage: {
			costUsd: reply.total_cost_usd ?? 0,
			inputTokens: usage.input_tokens ?? 0,
			outputTokens: usage.output_tokens ?? 0,
			cacheReadTokens: usage.cache_read_input_tokens ?? 0,
			cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
		},
	};
}

export interface GradeOptions {
	/** The model that grades, as `claude --model` takes it. */
	model: string;
}

/** A model's grade of one run, kept beside it. */
export interface Grade {
	model: string;
	/** Which rubric it graded, so a changed rubric grades again. */
	rubric: string;
	items: Record<string, { verdict: "pass" | "fail" | "n/a"; why: string }>;
	usage: Usage;
}

export function rubricHash(rubric: string[]): string {
	return createHash("sha256")
		.update(rubric.join("\n"))
		.digest("hex")
		.slice(0, 12);
}
