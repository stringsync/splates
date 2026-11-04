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
						...(typeof each.prompt === "string" ? { prompt: each.prompt } : {}),
						...(typeof each.judge === "string" || each.judge === null
							? { judge: each.judge }
							: {}),
						...(Array.isArray(each.checks)
							? {
									checks: each.checks.flatMap((check: unknown) => {
										if (
											typeof check !== "object" ||
											check === null ||
											!("id" in check) ||
											!("about" in check) ||
											typeof check.id !== "string" ||
											typeof check.about !== "string"
										) {
											return [];
										}
										return [{ id: check.id, about: check.about }];
									}),
								}
							: {}),
						group: typeof each.group === "string" ? each.group : null,
						about: typeof each.about === "string" ? each.about : null,
						...(typeof each.skill === "string" ? { skill: each.skill } : {}),
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
