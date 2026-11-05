import type { Repo } from "@evals/evals/scenario";
import type { Scenario } from "./scenario";

const aspect = "progress";

/**
 * The sandbox has no `splates server` or conversation, so `splates progress`
 * cannot succeed there. Every check reads the commands the agent attempted,
 * never whether they worked.
 */

/** Whether `command` runs `splates progress`. */
function reports(command: string): boolean {
	return /\bsplates\s+progress\b/.test(command);
}

/** Whether `command` pipes something into `splates progress <id> -`. */
function streams(command: string): boolean {
	return /\|\s*(?:\S*\/)?splates\s+progress\b[^|]*\s-(?:\s|$|["'])/.test(
		command,
	);
}

/** A script that prints a line per file of five, sleeping between them, and fails at file `failsAt` when given. */
async function importScript(repo: Repo, failsAt?: number): Promise<void> {
	await repo.write("package.json", '{"name":"importer","private":true}\n');
	await repo.write(
		"scripts/import.sh",
		[
			"#!/bin/sh",
			"for i in 1 2 3 4 5; do",
			'\techo "importing file $i of 5"',
			...(failsAt === undefined
				? []
				: [
						`\tif [ "$i" = ${failsAt} ]; then echo "error: bad row in file $i" >&2; exit 1; fi`,
					]),
			"\tsleep 1",
			"done",
			'echo "import complete"',
			"",
		].join("\n"),
	);
	await repo.run(["chmod", "+x", "scripts/import.sh"]);
}

export const scenarios: Scenario[] = [
	{
		id: `${aspect}/reports-long-task`,
		aspect,
		requirement:
			"A task that takes minutes is reported on a progress card (`splates progress`), not with a chat line per step.",
		seed: (repo) => importScript(repo),
		message:
			"scripts/import.sh takes a few minutes. Start it in the background and keep me posted on how it's going.",
		checks: [
			{
				id: "reports",
				about: "ran `splates progress` to show how the import is going",
				test: ({ commands }) => commands.some(reports),
			},
		],
		judge:
			"Does the reply give a short summary of how the import went or stands, rather than narrating every step of it one line at a time? Answer yes or no.",
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: `${aspect}/finishes-failed-card`,
		aspect,
		requirement:
			"A progress card is finished with `--done` or `--failed` to match how the task ended.",
		seed: (repo) => importScript(repo, 4),
		message: "Run scripts/import.sh and let me know how it goes.",
		checks: [
			{
				id: "failed",
				about: "finished a card with `splates progress ... --failed`",
				test: ({ commands }) =>
					commands.some(
						(command) => reports(command) && /--failed\b/.test(command),
					),
			},
			{
				id: "not-done",
				about: "never marked a card `--done`, since the import failed",
				test: ({ commands }) =>
					!commands.some(
						(command) => reports(command) && /--done\b/.test(command),
					),
			},
		],
		limits: { turns: 25, minutes: 10 },
	},
	{
		id: `${aspect}/short-task-no-card`,
		aspect,
		requirement:
			"A quick lookup gets no progress card: `splates progress` is for tasks that take minutes.",
		seed: async (repo) => {
			await repo.write("package.json", '{"name":"todos","private":true}\n');
			await repo.write(
				"src/a.ts",
				"// TODO: handle empty input\nexport const a = 1;\n",
			);
			await repo.write("src/b.ts", "export const b = 2; // TODO: rename\n");
			await repo.write("src/c.ts", "// TODO: remove\nexport const c = 3;\n");
		},
		message: "How many TODO comments are in src?",
		checks: [
			{
				id: "no-card",
				about: "never ran `splates progress`",
				test: ({ commands }) => !commands.some(reports),
			},
			{
				id: "counted",
				about: "the reply gives the count, 3",
				test: ({ reply }) => /\b(3|three)\b/i.test(reply),
			},
		],
		limits: { turns: 15, minutes: 5 },
	},
	{
		id: `${aspect}/streams-output`,
		aspect,
		requirement:
			"A command whose output carries its own progress is piped into `splates progress <id> -`, not copied into chat by hand.",
		seed: async (repo) => {
			await repo.write("package.json", '{"name":"builder","private":true}\n');
			await repo.write(
				"scripts/build.sh",
				[
					"#!/bin/sh",
					"for pct in 20 40 60 80 100; do",
					'\techo "building $pct%"',
					"\tsleep 1",
					"done",
					"",
				].join("\n"),
			);
			await repo.run(["chmod", "+x", "scripts/build.sh"]);
		},
		message:
			"Run scripts/build.sh. It prints how far along it is as it goes, and I'd like to follow that.",
		checks: [
			{
				id: "piped",
				about: "piped the script into `splates progress <id> -`",
				test: ({ commands }) => commands.some(streams),
			},
		],
		judge:
			"Does the reply avoid reproducing the script's progress lines one by one, as a running transcript? Answer yes or no.",
		limits: { turns: 20, minutes: 10 },
	},
];
