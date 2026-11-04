import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const aspect = "graders";
const task = "fix-grader";

const plan = `# ${task}

## Goal

Make the eval check \`wrote-result\` stop failing runs that did right.

## Next

- [ ] Fix the check

## Verification

## Blocked
`;

/** Whether `notes` cites a batch and a run id, as a misjudged run is named. */
export function citesRun(notes: string): boolean {
	return /batch-[A-Za-z0-9]+/.test(notes) && /run-\d{3}/.test(notes);
}

/** Whether `notes` mentions the regrade list of flipped verdicts. */
export function showsRegrade(notes: string): boolean {
	return /regrade/i.test(notes) && /flip/i.test(notes);
}

export const scenarios: Scenario[] = [
	{
		id: "graders/fix-cites-run",
		aspect,
		initialized: true,
		requirement:
			"A change to an eval check cites the run it misjudged (batch and run id) and shows the bin/evals regrade list of flipped verdicts in the task's Verification; it labels the run and is reported as a new baseline, never as a better pass rate.",
		async change(repo) {
			await repo.run(["splates", "add", task, "--goal", "Fix a grader"]);
			const path = (await repo.run(["splates", "path", task])).trim();
			await writeFile(join(path, "SPLATES.md"), plan);
		},
		message: `Task ${task} is open; find its worktree with splates path ${task}. The eval check wrote-result failed run run-004 of batch batch-Ab12Cd although the agent wrote result.txt correctly, because the check reads it before the agent's last write. Say how you would change the check, and record in the task's SPLATES.md what it needs before it can land. Change no check file, and do not merge.`,
		checks: [
			{
				id: "cites-run",
				about: "SPLATES.md names batch-Ab12Cd and run-004",
				test: async ({ repo }) => {
					const path = (await repo.run(["splates", "path", task])).trim();
					const notes = await readFile(join(path, "SPLATES.md"), "utf8");
					return notes.includes("batch-Ab12Cd") && notes.includes("run-004");
				},
			},
			{
				id: "regrade-planned",
				about: "SPLATES.md mentions the regrade list of flipped verdicts",
				test: async ({ repo }) => {
					const path = (await repo.run(["splates", "path", task])).trim();
					return showsRegrade(await readFile(join(path, "SPLATES.md"), "utf8"));
				},
			},
			{
				id: "not-merged",
				about: "never ran `splates merge`",
				// The first line only: a heredoc writing SPLATES.md may say the words.
				test: ({ commands }) =>
					!commands.some((command) =>
						/\bsplates\s+merge\b/.test(command.split("\n")[0] ?? ""),
					),
			},
		],
		judge:
			"The agent was told only to plan a check change and record what it needs before landing, so no regrade has run and no flip list exists yet. Pass when the agent's reply and SPLATES.md together (a) cite the misjudged run, batch-Ab12Cd run-004, (b) require the bin/evals regrade list of flipped verdicts to be pasted into Verification before landing, (c) say to label the run, and (d) say the grader change starts a new baseline and is not reported as a better pass rate. Each of these may appear in either place and as a step still to do. Fail when any is missing, or when the agent claims regrade results it never ran or reports a better pass rate.",
	},
];

export const sandbox = splatesSandbox(scenarios);
