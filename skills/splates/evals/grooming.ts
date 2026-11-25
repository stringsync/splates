import {
	addCmd,
	mergeCmd,
	noFailedSplatesCommands,
	noUnrelatedReferences,
	readReference,
	taskWorktrees,
	untouched,
	withinToolCalls,
} from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "grooming";

const PACKAGE = '{\n\t"name": "app",\n\t"type": "module"\n}\n';
const BILLING_EXPORT_TS =
	"export const exportBillingCsv = (rows: string[][]) => rows.map((r) => r.join(',')).join('\\n');\n";
const AUTH_TOKENS_TS =
	"export const issueToken = (userId: string) => 'tok_' + userId;\n";
const TASK_3_DETAIL =
	"Adds a PDF export button beside the billing CSV export so customers can download formatted invoices.";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string) => text.replace(ANSI, "");

const isTaskModify = (cmd: string) =>
	/\bsplates["']?\s+(?:task\s+(?:update|add|remove|defer)|lane\s+(?:add|update|remove)|board\s+(?:add|update|remove))\b/.test(
		cmd,
	);

const isDisallowedAction = (cmd: string) =>
	addCmd(cmd) ||
	mergeCmd(cmd) ||
	/\bsplates["']?\s+(?:remove|task\s+remove|queue\s+add|lane\s+queue)\b/.test(
		cmd,
	);

export const scenarios: Scenario[] = describe("splates skill", [
	describe("grooming", [
		it(
			"places an already-taken Backlog task on a fitting lane and board without changing anything else",
			{
				key: `${aspect}/places-taken-task`,
				initialized: true,
				detail:
					"When a `task.created` automation hands the groomer an ungroomed Backlog task that an agent has already taken, read `references/groom.md`, inspect the task and board/lanes, move the task into the fitting lane and board (`splates task update 3 --lane 2`), change nothing else about the task (detail, subject, slug, blockers, position, or assignee) or the repo, and reply with one short line saying where it went.",
				message:
					"[SPLATES EVENT task.created #3]\n\nGroom the task that was just added, as the splates skill's groom reference says for a task added to Backlog: organize it and place it in a lane, never do it.",
				environment:
					'An initialized splates repo with board 1 holding lane 1 (`Auth`, task #1), board 2 (`Billing`) holding lane 2 (`Billing export`, task #2), and ungroomed Backlog task #3 ("Add PDF export button") already taken by an agent.',
				example: [
					{
						kind: "tool",
						name: "Read",
						input: ".agents/skills/splates/references/groom.md",
						does: "Reads the grooming reference before acting on the event.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates task show 3",
						does: "Inspects task #3 and sees it is ungroomed in Backlog and already taken.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates lane list && splates board list",
						does: "Checks existing lanes and boards to find where task #3 belongs.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates task update 3 --lane 2",
						does: "Moves task #3 into lane 2 (`Billing export` on board `Billing`) without altering its detail, blockers, subject, or position.",
					},
					{
						kind: "text",
						text: "#3: in lane 2 Billing export",
					},
				],
				seed: async (repo) => {
					await repo.write("package.json", PACKAGE);
					await repo.write("src/billing/export.ts", BILLING_EXPORT_TS);
					await repo.write("src/auth/tokens.ts", AUTH_TOKENS_TS);
				},
				change: async (repo) => {
					await repo.run(["splates", "lane", "add", "Auth"]);
					await repo.run([
						"splates",
						"task",
						"add",
						"Rotate session tokens",
						"--slug",
						"rotate-session-tokens",
						"--lane",
						"1",
						"Session tokens rotate on refresh.",
					]);
					await repo.run(["splates", "board", "add", "Billing"]);
					await repo.run([
						"splates",
						"lane",
						"add",
						"Billing export",
						"--board",
						"2",
					]);
					await repo.run([
						"splates",
						"task",
						"add",
						"Add CSV export writer",
						"--slug",
						"csv-export-writer",
						"--lane",
						"2",
						"Serializes billing rows to CSV.",
					]);
					await repo.run([
						"splates",
						"task",
						"defer",
						"Add PDF export button",
						"--slug",
						"pdf-export-button",
						TASK_3_DETAIL,
					]);
					await repo.run([
						"splates",
						"add",
						"pdf-export-button",
						"--task",
						"3",
					]);
				},
				expect: [
					readReference("groom.md", {
						about: "modifying any task",
						test: isTaskModify,
					}),
					{
						id: "placed-in-fitting-lane-and-board",
						about:
							"Task #3 ends in lane 2 (`Billing export` on board `Billing`), not left in Backlog or moved to `Auth`.",
						live: true,
						test: async ({ repo }) => {
							const shown = stripAnsi(
								await repo.run(["splates", "task", "show", "3"]),
							);
							const board = await repo.run([
								"splates",
								"board",
								"show",
								"2",
								"--json",
							]);
							const inLane2 = /^\s*lane:\s+2\s+Billing export\b/m.test(shown);
							let lane2OnBoard2 = false;
							try {
								const parsed = JSON.parse(board) as { lanes?: number[] };
								lane2OnBoard2 = parsed.lanes?.includes(2) ?? false;
							} catch {
								lane2OnBoard2 = false;
							}
							return inLane2 && lane2OnBoard2;
						},
					},
					{
						id: "task-fields-unchanged",
						about:
							"Task #3's detail, subject, slug, blockers, and position are unchanged (no `#### From grooming` added).",
						live: true,
						test: async ({ repo }) => {
							const shown = stripAnsi(
								await repo.run(["splates", "task", "show", "3"]),
							);
							const [header = "", ...rest] = shown.split(/\r?\n\r?\n/);
							const body = rest.join("\n\n").trim();
							return (
								/^task 3 Add PDF export button$/m.test(header) &&
								/^\s*slug:\s+pdf-export-button$/m.test(header) &&
								/^\s*position:\s+3$/m.test(header) &&
								/^\s*taken by:\s+pdf-export-button$/m.test(header) &&
								!/^\s*blocked by:/m.test(header) &&
								body === TASK_3_DETAIL
							);
						},
					},
					{
						id: "no-code-or-lifecycle-actions",
						about:
							"Ran no task starts, merges, removals, or queue changes, and opened no new worktree.",
						live: true,
						test: async ({ commands, repo }) =>
							!commands.some(isDisallowedAction) &&
							(await taskWorktrees(repo)).length === 1,
					},
					untouched("src/billing/export.ts", "src/auth/tokens.ts"),
					noFailedSplatesCommands(),
					withinToolCalls(12),
					noUnrelatedReferences([
						"groom.md",
						"queue.md",
						"questions.md",
						"reporting.md",
					]),
				],
				judge:
					"Did the groomer place the taken task in the fitting lane and board, change nothing else about the task, and reply with one short line saying where it went? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 12, minutes: 5 },
			},
		),
	]),
]);

export const sandbox = splatesSandbox(scenarios);
