import type { Repo } from "@evals/evals/scenario";
import type { Scenario } from "./scenario";

const aspect = "orchestration";

/** The queued tasks as `splates task list --json` reads them in the sandbox's private home. */
export interface Queued {
	id: number;
	subject: string;
	text: string;
	lane: number | null;
	blockedBy: number[];
	takenBy: string | null;
}

/** Parses `splates task list --json`, keeping the fields the checks read. */
export function parseQueued(json: string): Queued[] {
	return (JSON.parse(json) as Queued[]).map(
		({ id, subject, text, lane, blockedBy, takenBy }) => ({
			id,
			subject,
			text,
			lane,
			blockedBy,
			takenBy,
		}),
	);
}

async function queued(repo: Repo): Promise<Queued[]> {
	return parseQueued(await repo.run(["splates", "task", "list", "--json"]));
}

/** Whether `command` starts a task from queued task `id`: `splates add <name> --task <id>`. */
export function startsTask(command: string, id: number): boolean {
	return new RegExp(`\\bsplates\\s+add\\b[^|;&]*--task[= ]${id}\\b`).test(
		command,
	);
}

/** A lane of two queued tasks, Base (1) and Other (2). */
async function board(repo: Repo): Promise<void> {
	await repo.run(["splates", "lane", "add", "Widgets"]);
	for (const { subject, text } of [
		{ subject: "Base", text: "Change base.ts" },
		{ subject: "Other", text: "Change other.ts" },
	]) {
		await repo.run([
			"splates",
			"task",
			"add",
			subject,
			text,
			"--slug",
			subject.toLowerCase(),
			"--lane",
			"1",
		]);
	}
}

export const scenarios: Scenario[] = [
	{
		id: "orchestration/taken-queued",
		aspect,
		requirement:
			"A queued task another agent already took is not started again: inspect it with `splates task show` and tell the user who has it.",
		initialized: true,
		async change(repo) {
			await board(repo);
			await repo.run(["splates", "add", "work-1", "--task", "1"]);
		},
		message:
			"[SPLATES TASK #1]\nStop at the first decision or report; do not implement anything.",
		checks: [
			{
				id: "inspected",
				about: "ran `splates task show 1`",
				test: ({ commands }) =>
					commands.some((command) =>
						/\bsplates\s+task\s+show\s+1\b/.test(command),
					),
			},
			{
				id: "not-restarted",
				about: "never started task 1 again",
				test: ({ commands }) =>
					!commands.some((command) => startsTask(command, 1)),
			},
		],
		judge:
			"Pass when the reply tells the user that task 1 was already taken by another task (work-1) rather than starting it. Fail when it claims to have started the work.",
	},
	{
		id: "orchestration/groom-duplicate",
		aspect,
		requirement:
			"As the groomer, fold an ungroomed Backlog task that duplicates another into it with `splates task remove`, never start or queue it.",
		initialized: true,
		async change(repo) {
			await board(repo);
			await repo.run([
				"splates",
				"task",
				"defer",
				"Base again",
				"Change base.ts, as Base asks",
				"--slug",
				"base-again",
			]);
		},
		message: "[SPLATES GROOM #3]",
		checks: [
			{
				id: "folded",
				about: "task 3 is gone and tasks 1 and 2 remain",
				test: async ({ repo }) =>
					(await queued(repo))
						.map((task) => task.id)
						.sort()
						.join() === "1,2",
			},
			{
				id: "not-started",
				about: "never started task 3",
				test: ({ commands }) =>
					!commands.some((command) => startsTask(command, 3)),
			},
		],
	},
	{
		id: "orchestration/defer",
		aspect,
		requirement:
			"`[SPLATES DEFER]` saves the request as given with `splates task defer`, rough in Backlog, without investigating it.",
		initialized: true,
		message:
			"[SPLATES DEFER] Add a widget. Preserve this entire detail: Change widget.ts and add a regression test. Name the task 'Add widget' with detail 'Change widget.ts and add a regression test.' and slug 'add-widget'; leave it ungroomed in Backlog.",
		checks: [
			{
				id: "saved",
				about: "one queued task keeps the name, detail and no lane",
				test: async ({ repo }) => {
					const tasks = await queued(repo);
					return (
						tasks.length === 1 &&
						tasks[0]?.subject === "Add widget" &&
						tasks[0].text === "Change widget.ts and add a regression test." &&
						tasks[0].lane === null
					);
				},
			},
			{
				id: "no-investigation",
				about: "never searched for widget.ts",
				test: ({ commands }) =>
					!commands.some((command) =>
						/\b(grep|rg|find|cat)\b.*widget/.test(command),
					),
			},
		],
	},
	{
		id: "orchestration/offers-lane",
		aspect,
		requirement:
			"A request that is several medium changes gets a numbered Yes/No offer of a lane, with the split named, before any of the work.",
		initialized: true,
		async seed(repo) {
			await repo.write(
				"csv.ts",
				'export function toCsv(): string {\n\treturn "";\n}\n',
			);
			await repo.write("server.ts", "export const routes: string[] = [];\n");
			await repo.write("page.ts", 'export const page = "<main></main>";\n');
		},
		message:
			"Add CSV export: a writer that turns rows into CSV, an /export endpoint that uses it, and a button on the page that calls the endpoint. Stop at the first decision or report; do not implement anything before I answer.",
		checks: [
			{
				id: "no-lane-yet",
				about: "did not add a lane before the user answered",
				test: ({ commands }) =>
					!commands.some((command) => /\bsplates\s+lane\s+add\b/.test(command)),
			},
		],
		judge:
			"Pass when the reply asks, as a numbered question with Yes and No choices, whether to split the request into a lane of separate tasks, naming the pieces (the writer, the endpoint, the button), and has not written the code. Fail when it starts implementing, or splits without asking.",
	},
	{
		id: "orchestration/one-change-no-offer",
		aspect,
		requirement:
			"A request that is one medium change gets no lane offer: the agent does the change in its task.",
		initialized: true,
		async seed(repo) {
			await repo.write(
				"csv.ts",
				'export function toCsv(rows: string[][]): string {\n\treturn rows.map((row) => row.join(",")).join("\\n");\n}\n',
			);
		},
		message: "Make the CSV writer in csv.ts quote fields that contain commas.",
		checks: [
			{
				id: "no-lane",
				about: "never added a lane or a queued task",
				test: ({ commands }) =>
					!commands.some((command) =>
						/\bsplates\s+(lane\s+add|task\s+add)\b/.test(command),
					),
			},
		],
		judge:
			"Pass when the agent works on the change itself and does not ask whether to split it into a lane or several tasks. Fail when the reply offers a lane.",
	},
	{
		id: "orchestration/declined-lane",
		aspect,
		requirement:
			"When the user chooses one task over a lane, the agent does all of it in that task and does not queue split points.",
		initialized: true,
		async seed(repo) {
			await repo.write(
				"csv.ts",
				'export function toCsv(): string {\n\treturn "";\n}\n',
			);
			await repo.write("server.ts", "export const routes: string[] = [];\n");
			await repo.write("page.ts", 'export const page = "<main></main>";\n');
		},
		message:
			"Add CSV export: a writer that turns rows into CSV, an /export endpoint that uses it, and a button on the page that calls the endpoint. Do all of it in one task, not as a lane.",
		checks: [
			{
				id: "no-split",
				about: "never added a lane or a queued task",
				test: ({ commands }) =>
					!commands.some((command) =>
						/\bsplates\s+(lane\s+add|task\s+add|task\s+defer)\b/.test(command),
					),
			},
		],
		judge:
			"Pass when the agent carries out the export in one task without asking again about a lane. Fail when it offers to split, or leaves pieces as follow-up tasks.",
	},
];
