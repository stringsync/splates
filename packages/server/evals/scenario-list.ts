import type { Priority } from "@evals/evals/scenario";
import type { EvalExampleTurn, EvalScenario } from "./launch";
import { type PassRule, parsePassRule } from "./pass-rule";

const PRIORITIES = new Set<string>(["high", "normal", "low"]);

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
						...(typeof each.judgeWith === "string"
							? { judgeWith: each.judgeWith }
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
						...(typeof each.sentence === "string" && each.sentence !== ""
							? { sentence: each.sentence }
							: {}),
						...(Array.isArray(each.groups) &&
						each.groups.every((group: unknown) => typeof group === "string")
							? { groups: each.groups as string[] }
							: {}),
						...(parsePassRule(each.pass) === null
							? {}
							: { pass: parsePassRule(each.pass) as PassRule }),
						...(typeof each.priority === "string" &&
						PRIORITIES.has(each.priority)
							? { priority: each.priority as Priority }
							: {}),
						...(typeof each.environment === "string" && each.environment !== ""
							? { environment: each.environment }
							: {}),
						...(Array.isArray(each.example) && each.example.length > 0
							? { example: each.example.flatMap(turnOf) }
							: {}),
						...(typeof each.skill === "string" ? { skill: each.skill } : {}),
						...(typeof each.file === "string" && each.file !== ""
							? { file: each.file }
							: {}),
					},
				];
	});
}

/** One step of a listed example reply; none when it is neither words nor a named tool call. */
function turnOf(turn: unknown): EvalExampleTurn[] {
	if (typeof turn !== "object" || turn === null) {
		return [];
	}
	const each = turn as Record<string, unknown>;
	if (each.kind === "text" && typeof each.text === "string") {
		return [{ kind: "text", text: each.text }];
	}
	if (each.kind === "tool" && typeof each.name === "string") {
		return [
			{
				kind: "tool",
				name: each.name,
				input: typeof each.input === "string" ? each.input : "",
				does: typeof each.does === "string" ? each.does : null,
			},
		];
	}
	return [];
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
