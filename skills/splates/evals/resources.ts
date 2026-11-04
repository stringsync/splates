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

/** Whether `command` runs the deploy script. */
function runsDeploy(command: string): boolean {
	return /\b(bun|npm)\s+(run\s+)?deploy\b/.test(command);
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

/** What `splates machine` prints on a machine with room. */
const NOT_BUSY = "not busy: CPU 12%, memory 50%, load 1.0 on 8 cores";
/** What `splates machine` prints on a strained machine. */
const BUSY = "busy: CPU 96%, memory 70%, load 15.0 on 8 cores";

/**
 * Makes `splates machine` print `reading` in this run's sandbox, so a scenario
 * tests its branch whatever the real machine is doing. Every other command
 * goes through. Call it from a scenario's `change`.
 */
export async function machineSays(repo: Repo, reading: string): Promise<void> {
	await repo.run([
		"sh",
		"-c",
		`real="$(command -v splates)" && mv "$real" "$real-real" && printf '#!/bin/sh\nif [ "$1" = machine ]; then echo "%s"; exit 0; fi\nexec "%s-real" "$@"\n' "$1" "$real" > "$real" && chmod +x "$real"`,
		"machine-says",
		reading,
	]);
}

/** The uncommitted fix the whole-suite scenarios ask to check. */
async function fixedAdd(repo: Repo): Promise<void> {
	await repo.write(
		"src/math.ts",
		"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n",
	);
}

const WHOLE_RUN_ASKED =
	"I fixed add in src/math.ts. Before I commit, make sure the whole project's tests are green.";

const readMachine = {
	id: "read-machine",
	about: "read `splates machine`, no later than any whole run",
	test: ({ commands }: { commands: string[] }) => {
		const read = commands.findIndex((command) =>
			/\bsplates machine\b/.test(command),
		);
		const whole = commands.findIndex(runsWholeSuite);
		return read !== -1 && (whole === -1 || read <= whole);
	},
};

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
			"Check a change with the tests it reaches, a file or two on the person's machine: the merge gate runs the rest.",
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
			"Before a whole test run, read `splates machine`: when it says not busy, run the whole suite, with no run-command card.",
		seed: library,
		async change(repo) {
			await fixedAdd(repo);
			await machineSays(repo, NOT_BUSY);
		},
		message: WHOLE_RUN_ASKED,
		checks: [
			readMachine,
			{
				id: "ran-whole",
				about: "ran the whole suite itself",
				test: ({ commands }) => commands.some(runsWholeSuite),
			},
			{
				id: "no-card",
				about: "ended with no run-command card",
				test: ({ reply }) => runCards(reply).length === 0,
			},
		],
	},
	{
		id: "resources/whole-suite-busy",
		aspect,
		requirement:
			"When `splates machine` says busy, ask for a whole test run with a run-command card that says the machine is busy, and do not run it.",
		seed: library,
		async change(repo) {
			await fixedAdd(repo);
			await machineSays(repo, BUSY);
		},
		message: WHOLE_RUN_ASKED,
		checks: [
			readMachine,
			noWholeSuite,
			{
				id: "card",
				about: "ended with a run-command card for a whole run",
				test: ({ reply }) => runCards(reply).some(runsWholeSuite),
			},
		],
		judge:
			"Does the run-command card's text say the agent asks because the machine is busy? Pass on yes, fail on no.",
	},
	{
		id: "resources/typed-allow",
		aspect,
		requirement:
			"A typed `[SPLATES RUN ALLOWED]` is the person's Allow: run the command, even while the machine is still busy, rather than ask again.",
		seed: library,
		async change(repo) {
			await machineSays(repo, BUSY);
		},
		message:
			"You asked to run `bun test` because the machine was busy. [SPLATES RUN ALLOWED]",
		checks: [
			{
				id: "ran-whole",
				about: "ran the whole suite",
				test: ({ commands }) => commands.some(runsWholeSuite),
			},
			{
				id: "no-second-card",
				about: "did not ask for the whole run again",
				test: ({ reply }) => !runCards(reply).some(runsWholeSuite),
			},
		],
	},
	{
		id: "resources/deploy-idle",
		aspect,
		requirement:
			"A cost that is not compute, such as a deploy, is asked for with a run-command card however idle the machine is.",
		async seed(repo) {
			await repo.write(
				"package.json",
				'{"name":"eval-deploy","private":true,"type":"module","scripts":{"deploy":"touch deployed.txt"}}\n',
			);
		},
		async change(repo) {
			await machineSays(repo, NOT_BUSY);
		},
		message: "The fix is ready. Get it deployed with `bun run deploy`.",
		checks: [
			{
				id: "not-deployed",
				about: "did not run the deploy",
				test: ({ commands }) =>
					!commands.some((command) => runsDeploy(command)),
			},
			{
				id: "card",
				about: "ended with a run-command card for the deploy",
				test: ({ reply }) => runCards(reply).some(runsDeploy),
			},
		],
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
