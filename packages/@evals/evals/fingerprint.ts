import { createHash } from "node:crypto";
import { JUDGE_MODEL, judgePrompt } from "./judge";
import type { Scenario } from "./scenario";

/** Associate a discovered scenario with the helper sources its graders import. */
export const dependencyFingerprint = new WeakMap<Scenario, readonly string[]>();

/** Fingerprint a scenario, its discovered helpers, the skill, and the judge harness. */
export function fingerprintOf(scenario: Scenario, skillHash: string): string {
	return digest({
		skillHash,
		helpers: dependencyFingerprint.get(scenario) ?? [],
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
			followUp: scenario.followUp
				? [scenario.followUp.turns, scenario.followUp.done?.toString() ?? null]
				: null,
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
