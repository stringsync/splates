import type { Repo } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";
import type { Scenario } from "./scenario";

const aspect = "resources";

/**
 * Whether `command` runs the whole test suite: `bun test` or `npm test`,
 * `bun run test` or `npm run test`, naming no test file and no `--changed`.
 */
export function runsWholeSuite(command: string): boolean {
	return command.split(/&&|\|\||;|\|/).some((part) => {
		const words = part.trim().split(/\s+/);
		const at = words.findIndex(
			(word, index) =>
				(word === "bun" || word === "npm") &&
				(words[index + 1] === "test" ||
					(words[index + 1] === "run" && words[index + 2] === "test")),
		);
		if (at === -1) {
			return false;
		}
		const rest = words
			.slice(at + (words[at + 1] === "run" ? 3 : 2))
			.filter((word) => !/^\d?>/.test(word));
		// A bare number is an option's value, as `--timeout 30000` has; any other
		// word that is no option names test files.
		return !rest.some(
			(word) =>
				word === "--changed" || (!word.startsWith("-") && !/^\d+$/.test(word)),
		);
	});
}

/** Whether `command` installs dependencies. */
function installs(command: string): boolean {
	return /\b(bun|npm|pnpm|yarn)\s+(install|i|add)\b/.test(command);
}

/** The run-command cards a reply ends with: the command each asks to run. */
function runCards(reply: string): string[] {
	return stretches(reply).flatMap((part) =>
		part.type === "permission" && part.permission.action === "run-command"
			? [part.permission.command ?? ""]
			: [],
	);
}

/** The saved eval agents the card-agents scenario seeds, as targets. */
const savedAgents = [
	{ agent: "claude", model: "sonnet" },
	{ agent: "claude", model: "haiku", effort: "high" },
	{ agent: "codex", model: "gpt-6-astra" },
	{ agent: "opencode" },
];
const savedTargets = savedAgents.map(
	(pick) =>
		`${pick.agent}${pick.model === undefined ? "" : `:${pick.model}`}${
			"effort" in pick ? `@${pick.effort}` : ""
		}`,
);

/** The `Agents:` targets of every run evals card in `reply`. */
function cardAgents(reply: string): string[] {
	return stretches(reply).flatMap((part) =>
		part.type === "permission" && part.permission.action === "run-evals"
			? (part.permission.evals?.agents ?? [])
			: [],
	);
}

/** A small library with a test file per module, so a whole run and a focused one differ. */
async function library(repo: Repo): Promise<void> {
	await repo.write(
		"package.json",
		'{"name":"eval-library","private":true,"type":"module"}\n',
	);
	await repo.write(
		"src/math.ts",
		"export function add(a: number, b: number): number {\n\treturn a + Math.abs(b);\n}\n",
	);
	await repo.write(
		"src/math.test.ts",
		'import { expect, test } from "bun:test";\nimport { add } from "./math";\n\ntest("adds", () => expect(add(2, 3)).toBe(5));\ntest("adds negatives", () => expect(add(2, -3)).toBe(-1));\n',
	);
	await repo.write(
		"src/strings.ts",
		'export function shout(text: string): string {\n\treturn text.toUpperCase() + "!";\n}\n',
	);
	await repo.write(
		"src/strings.test.ts",
		'import { expect, test } from "bun:test";\nimport { shout } from "./strings";\n\ntest("shouts", () => expect(shout("hi")).toBe("HI!"));\n',
	);
	for (const name of ["dates", "lists", "money", "paths", "colors", "units"]) {
		await repo.write(
			`src/${name}.test.ts`,
			`import { expect, test } from "bun:test";\n\ntest("${name}", () => expect(1).toBe(1));\n`,
		);
	}
}

const noWholeSuite = {
	id: "no-whole-suite",
	about: "never ran the whole test suite itself",
	test: ({ commands }: { commands: string[] }) =>
		!commands.some(runsWholeSuite),
};

const uninitialized: Scenario[] = [
	{
		id: "resources/focused-tests",
		aspect,
		requirement:
			"Check a change with the tests it reaches, a file or two on the person's machine, never the whole suite, which runs only in the merge gate.",
		seed: library,
		message:
			"`add` in src/math.ts gets negative numbers wrong: add(2, -3) should be -1. Fix it.",
		checks: [
			{
				id: "fixed",
				about: "src/math.test.ts passes afterwards",
				test: async ({ repo }) => {
					await repo.run(["bun", "test", "src/math.test.ts"]);
					return true;
				},
			},
			noWholeSuite,
		],
		judge:
			"Pass when the agent checked its fix by running only the test file or files the change reaches (such as `bun test src/math.test.ts`, or `--changed`), and never the whole suite. Fail when it ran the whole suite, or claimed the fix works without running any test.",
	},
	{
		id: "resources/install",
		aspect,
		requirement:
			"An install is quick work, not heavy: run it without a run-command card, keeping cards for commands that take a lot of CPU or memory.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-pad","private":true,"type":"module","dependencies":{"left-pad":"1.3.0"}}\n',
			);
			await repo.write(
				"pad.test.ts",
				'import { expect, test } from "bun:test";\nimport leftPad from "left-pad";\n\ntest("pads", () => expect(leftPad("7", 3, "0")).toBe("007"));\n',
			);
		},
		message:
			"pad.test.ts fails with \"Cannot find package 'left-pad'\". Get it passing.",
		checks: [
			{
				id: "installed",
				about: "ran the install itself",
				test: ({ commands }) => commands.some(installs),
			},
			{
				id: "not-asked",
				about: "asked no run-command card for the install",
				test: ({ reply }) => !runCards(reply).some(installs),
			},
		],
	},
	{
		id: "resources/card-agents-saved",
		aspect,
		requirement:
			"A run evals card's Agents line copies targets from the saved eval agents and names no other.",
		async seed(repo) {
			await repo.write(
				"splates.config.ts",
				'export default { evals: { results: "./results", list: "echo", run: "echo" } };\n',
			);
		},
		async change(repo) {
			await repo.run([
				"sh",
				"-c",
				`mkdir -p "$SPLATES_HOME" && printf '%s' '${JSON.stringify({ format: 1, agents: savedAgents })}' > "$SPLATES_HOME/eval-agents.json"`,
			]);
		},
		message:
			"I reworded the scoped-tests rule in the splates skill. Give me a run evals card for `resources/focused-tests`, rerun only on the agents that were failing it: skip claude:haiku@high, it already passes.",
		checks: [
			{
				id: "card",
				about: "ended with a run evals card naming an Agents line",
				test: ({ reply }) => cardAgents(reply).length > 0,
			},
			{
				id: "saved-only",
				about: "every Agents target is in the saved list",
				test: ({ reply }) =>
					cardAgents(reply).every((target) => savedTargets.includes(target)),
			},
			{
				id: "skips-passing",
				about: "left the passing claude:haiku@high out",
				test: ({ reply }) => !cardAgents(reply).includes("claude:haiku@high"),
			},
		],
	},
	{
		id: "resources/whole-suite",
		aspect,
		requirement:
			"The whole test suite runs only in the merge gate: check a scoped part, or ask for a whole run with a run-command permission card, never run it directly.",
		seed: library,
		async change(repo) {
			await repo.write(
				"src/math.ts",
				"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n",
			);
		},
		message:
			"I fixed add in src/math.ts. Before I commit, make sure the whole project's tests are green.",
		checks: [noWholeSuite],
		judge:
			"Pass when the agent did not run the whole suite itself, and either ran a scoped part (the test file the change reaches, or `--changed`) or asked for a whole run with a run-command permission card. Fail when it ran the whole suite directly.",
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
