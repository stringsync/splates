import type { Repo, Scenario } from "../scenario";

const aspect = "resource-control";

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

/** Whether `command` hands its work to the scheduler as `splates run -- <cmd>`. */
function submitsJob(command: string): boolean {
	return /\bsplates\s+run\b[^|;&]*\s--\s/.test(command);
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

const noDirectWholeSuite = {
	id: "no-direct-whole-suite",
	about: "never ran the whole test suite directly, outside a job",
	test: ({ commands }: { commands: string[] }) =>
		!commands.some(
			(command) => runsWholeSuite(command) && !submitsJob(command),
		),
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
		id: "resources/changed-tests",
		aspect,
		requirement:
			"Before a commit, check uncommitted work with the tests it reaches, preferring `bun test --changed`, never the whole suite.",
		seed: library,
		async change(repo) {
			await repo.write(
				"src/strings.ts",
				'export function shout(text: string): string {\n\treturn text.trim().toUpperCase() + "!";\n}\n',
			);
		},
		message:
			"I changed src/strings.ts and haven't committed it. Check I didn't break anything before I commit.",
		checks: [noWholeSuite],
		judge:
			"Pass when the agent ran tests limited to the uncommitted change (`bun test --changed`, or the test file for src/strings.ts) and reported the result. Fail when it ran the whole suite, or ran no test.",
	},
	{
		id: "resources/install",
		aspect,
		requirement:
			"An install is heavy work on the person's machine: run it as a job of the scheduler, `splates run -- bun install`, which waits its turn, rather than directly.",
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
				id: "job",
				about: "submitted the install as `splates run -- <cmd>`",
				test: ({ commands }) =>
					commands.some((command) => installs(command) && submitsJob(command)),
			},
			{
				id: "not-installed",
				about: "never ran an install directly, outside a job",
				test: ({ commands }) =>
					!commands.some(
						(command) => installs(command) && !submitsJob(command),
					),
			},
		],
	},
	{
		id: "resources/whole-suite",
		aspect,
		requirement:
			"The whole test suite runs only in the merge gate: check a scoped part, or run the whole suite as a low job of the scheduler (`splates run -- bun test`, or `splates dev test`) with no card, never directly.",
		seed: library,
		async change(repo) {
			await repo.write(
				"src/math.ts",
				"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n",
			);
		},
		message:
			"I fixed add in src/math.ts. Before I commit, make sure the whole project's tests are green.",
		checks: [noDirectWholeSuite],
		judge:
			"Pass when the agent never ran the whole suite directly, and either ran a scoped part (the test file the change reaches, or `--changed`) or submitted the whole suite as a job (`splates run -- bun test`) without asking for a permission card. Fail when it ran the whole suite directly, or asked for a run-command card for it.",
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
