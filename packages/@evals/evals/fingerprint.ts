import { createHash } from "node:crypto";
import { JUDGE_MODEL, judgePrompt } from "./judge";
import type { Scenario } from "./scenario";

/**
 * What a scenario's verdict depends on, as one hash: the scenario itself (its
 * message, requirement, seed, change, checks with their code, judge rubric and
 * limits), the installed skill's hash, and the shared judge harness (prompt
 * template and model). Editing one scenario changes only its fingerprint;
 * editing the skill or the judge harness changes every one.
 */
export function fingerprintOf(scenario: Scenario, skillHash: string): string {
	return digest({
		skillHash,
		judge: judgeHarness(),
		scenario: {
			id: scenario.id,
			aspect: scenario.aspect,
			requirement: scenario.requirement,
			message: scenario.message,
			seed: scenario.seed?.toString() ?? null,
			change: scenario.change?.toString() ?? null,
			checks: (scenario.checks ?? []).map((check) => [
				check.id,
				check.about,
				check.test.toString(),
			]),
			judge: scenario.judge ?? null,
			limits: scenario.limits ?? null,
		},
	});
}

/** The judge's model and its prompt template, with the run's parts blanked out. */
function judgeHarness(): { model: string; template: string } {
	const marks = {
		requirement: "\0requirement",
		rubric: "\0rubric",
		message: "\0message",
		reply: "\0reply",
	};
	return {
		model: JUDGE_MODEL,
		template: judgePrompt({ ...marks, transcript: [] }),
	};
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
