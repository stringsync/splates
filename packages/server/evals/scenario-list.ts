import type { EvalScenario } from "./launch";

/** The cases a project's `evals.list` printed, one JSON object a line; a line that is no case is skipped. */
export function parseScenarioList(stdout: string): EvalScenario[] {
	return stdout.split("\n").flatMap((line) => {
		const each = parsed(line);
		return each === null || typeof each.case !== "string" || each.case === ""
			? []
			: [
					{
						id: each.case,
						group: typeof each.group === "string" ? each.group : null,
						about: typeof each.about === "string" ? each.about : null,
						...(typeof each.skill === "string" ? { skill: each.skill } : {}),
						...(typeof each.fingerprint === "string"
							? { fingerprint: each.fingerprint }
							: {}),
					},
				];
	});
}

/** `line` as a JSON object; null when it is not one. */
export function parsed(line: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(line);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
