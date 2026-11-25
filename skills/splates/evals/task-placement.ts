import type { Check, Repo } from "@evals/evals/scenario";
import { untouched } from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const boardList = /\bsplates["']?\s+board\s+list\b/;
const laneList = /\bsplates["']?\s+lane\s+list\b/;
const taskAdd = /\bsplates["']?\s+task\s+add\b/;
const laneChoice = /\bsplates["']?\s+(?:lane\s+add|task\s+add)\b/;
const startNumbered = /\bsplates["']?\s+add\b[^\n;&|]*--task(?:\s+|=)["']?3\b/;
const placeStarted =
	/\bsplates["']?\s+task\s+update\s+["']?3["']?\s+[^\n;&|]*--lane(?:\s+|=)["']?2\b/;
const exportPath = "src/billing/csv.ts";

const listExample = {
	kind: "tool",
	name: "Bash",
	input: "splates board list && splates lane list",
} as const;

const exportGoal =
	"Customer names containing commas are quoted in billing CSV exports.";

export const scenarios: Scenario[] = describe("splates skill", [
	describe("task placement", [
		it("adds a task directly to the existing lane that fits", {
			key: "task-placement/queued-existing-lane",
			initialized: true,
			message:
				"Queue a task to make the billing CSV exporter quote customer names that contain commas.",
			environment:
				"An initialized repo with the billing CSV writer, lane 1 Auth on Default, and lane 2 Billing export on Billing. Each lane has one unrelated or adjacent task.",
			example: [
				{ ...listExample, does: "Finds Billing export on the Billing board." },
				{
					kind: "tool",
					name: "Bash",
					input: `splates task add "Quote customer names in CSV exports" --slug quote-csv-names --lane 2 "${exportGoal}"`,
					does: "Creates the task directly in Billing export.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: "splates queue add 3",
					does: "Queues the task after placing it.",
				},
				{ kind: "text", text: "Queued the CSV quoting fix in Billing export." },
			],
			seed: seedExport,
			change: seedBoard,
			expect: [
				listsBefore(taskAdd, "adding the task"),
				{
					id: "added-in-fitting-lane",
					about:
						"The task is created with lane 2 and ends there on the Billing board. Leaving it in Default Backlog for grooming fails.",
					live: true,
					test: async ({ commands, repo }) => {
						const add = commands
							.join("\n")
							.match(
								/\bsplates["']?\s+task\s+add\b[^\n;&|]*--lane(?:\s+|=)["']?2\b/,
							);
						return add !== null && (await taskInBillingLane(repo, 2));
					},
				},
			],
			limits: { turns: 16, minutes: 5 },
		}),
		it("places a numbered Backlog task promptly when starting it", {
			key: "task-placement/direct-start",
			initialized: true,
			message:
				"Start the billing CSV quoting task. Pause before editing the exporter.",
			environment:
				"An initialized repo with the CSV writer, numbered Backlog task 3, and a Billing export lane on the Billing board.",
			example: [
				{
					kind: "tool",
					name: "Bash",
					input: "splates add quote-csv-names --task 3",
					does: "Starts the numbered Backlog task in a worktree.",
				},
				{ ...listExample, does: "Finds Billing export on the Billing board." },
				{
					kind: "tool",
					name: "Bash",
					input: "splates task update 3 --lane 2",
					does: "Moves the started task into the fitting lane before pausing.",
				},
				{
					kind: "text",
					text: "Started the CSV quoting task in Billing export and paused before editing.",
				},
			],
			seed: seedExport,
			change: async (repo) => {
				await seedBoard(repo);
				await repo.run([
					"splates",
					"task",
					"defer",
					"Quote customer names in billing CSV exports",
					"--slug",
					"quote-csv-names",
					exportGoal,
				]);
			},
			expect: [
				listsBefore(placeStarted, "moving the started task"),
				{
					id: "started-before-placement",
					about: "Starts task 3 before moving it with task update.",
					test: ({ commands }) => {
						const shell = commands.join("\n");
						const start = shell.search(startNumbered);
						return start >= 0 && start < shell.search(placeStarted);
					},
				},
				{
					id: "started-in-fitting-lane",
					about:
						"Task 3 is taken and ends in Billing export on the Billing board.",
					live: true,
					test: async ({ repo }) =>
						(await taskInBillingLane(repo, 2)) &&
						(await newTask(repo)).takenBy !== null,
				},
				untouched(exportPath),
			],
			limits: { turns: 16, minutes: 5 },
		}),
		it("places a new lane on the board that fits its work", {
			key: "task-placement/new-lane-board",
			initialized: true,
			message:
				"Add a task to validate stored tax IDs. It’s the first step in a billing tax ID cleanup, and I’ll add the later steps separately. Leave it off the queue for now.",
			environment:
				"An initialized repo with billing tax ID code, board 2 Billing with an export lane, and Default with an Auth lane. There is no tax ID lane.",
			example: [
				{
					...listExample,
					does: "Finds the Billing board and sees that its existing export lane covers different work.",
				},
				{
					kind: "tool",
					name: "Bash",
					input: 'splates lane add "Tax ID cleanup" --board 2',
					does: "Creates the new lane on the Billing board.",
				},
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates task add "Validate stored tax IDs" --slug validate-tax-ids --lane 3 "Stored billing tax IDs are validated."',
					does: "Adds the first cleanup task to the new lane.",
				},
				{
					kind: "text",
					text: "Added the validation task to Tax ID cleanup on the Billing board.",
				},
			],
			seed: async (repo) => {
				await repo.write(
					"src/billing/tax-id.ts",
					"export const storedTaxId = (value: string) => value.trim();\n",
				);
			},
			change: seedBoard,
			expect: [
				listsBefore(laneChoice, "choosing where the new lane belongs"),
				{
					id: "new-lane-on-fitting-board",
					about:
						"A newly created tax ID lane holds the task and ends on board 2. Creating the lane on Default and moving it to Billing also passes.",
					live: true,
					test: async ({ repo }) => {
						const { lane } = await newTask(repo);
						if (
							lane === null ||
							lane <= 2 ||
							!(await taskInBillingLane(repo, lane))
						) {
							return false;
						}
						const named = await readJson<{ name: string }>(
							repo,
							"lane",
							"show",
							String(lane),
						);
						return /\btax\b/i.test(named.name);
					},
				},
			],
			limits: { turns: 16, minutes: 5 },
		}),
		it("uses Backlog for a standalone task with no fitting lane", {
			key: "task-placement/unmatched-backlog",
			initialized: true,
			message:
				"Add a task to fix the broken contributor guide link in the README. Leave it off the queue for now.",
			environment:
				"An initialized repo with a broken contributor guide link and only Auth and Billing export lanes. No open task is related to the link fix.",
			example: [
				{
					...listExample,
					does: "Checks the available boards and lanes for a fit.",
				},
				{
					kind: "tool",
					name: "Bash",
					input:
						'splates task add "Fix contributor guide link" --slug fix-contributor-link --lane backlog "The README links to the contributor guide at its current path."',
					does: "Adds the standalone fix to Backlog.",
				},
				{
					kind: "text",
					text: "Added the contributor guide link fix to Backlog.",
				},
			],
			seed: async (repo) => {
				await repo.write(
					"README.md",
					"# App\n\n[Contributor guide](contributing.md)\n",
				);
				await repo.write("docs/contributing.md", "# Contributing\n");
			},
			change: seedBoard,
			expect: [
				listsBefore(taskAdd, "adding the task"),
				{
					id: "backlog-with-no-new-lane",
					about:
						"The new task ends in Backlog and the set of lanes stays the same.",
					live: true,
					test: async ({ repo }) => {
						const lanes = await readJson<{ lane: number }[]>(
							repo,
							"lane",
							"list",
						);
						const namedLanes = lanes
							.filter(({ lane }) => lane !== 0)
							.map(({ lane }) => lane);
						return (
							(await newTask(repo)).lane === 0 &&
							namedLanes.length === 2 &&
							namedLanes.includes(1) &&
							namedLanes.includes(2)
						);
					},
				},
			],
			limits: { turns: 16, minutes: 5 },
		}),
	]),
]);

export const sandbox = splatesSandbox(scenarios);

async function seedExport(repo: Repo): Promise<void> {
	await repo.write(
		exportPath,
		'export const billingCsv = (names: string[]) => names.join(",");\n',
	);
}

async function seedBoard(repo: Repo): Promise<void> {
	await repo.run(["splates", "lane", "add", "Auth"]);
	await repo.run([
		"splates",
		"task",
		"add",
		"Rotate refresh tokens",
		"--slug",
		"rotate-refresh-tokens",
		"--lane",
		"1",
		"Refresh tokens rotate on use.",
	]);
	await repo.run(["splates", "board", "add", "Billing"]);
	await repo.run(["splates", "lane", "add", "Billing export", "--board", "2"]);
	await repo.run([
		"splates",
		"task",
		"add",
		"Document billing CSV columns",
		"--slug",
		"document-csv-columns",
		"--lane",
		"2",
		"The operator guide lists the billing CSV columns.",
	]);
}

function listsBefore(action: RegExp, description: string): Check {
	return {
		id: "lists-before-placement",
		about: `Reads both the board and lane lists before ${description}.`,
		test: ({ commands }) => {
			const shell = commands.join("\n");
			const actionAt = shell.search(action);
			const boardAt = shell.search(boardList);
			const laneAt = shell.search(laneList);
			return (
				boardAt >= 0 && laneAt >= 0 && boardAt < actionAt && laneAt < actionAt
			);
		},
	};
}

async function readJson<T>(repo: Repo, ...args: string[]): Promise<T> {
	return JSON.parse(await repo.run(["splates", ...args, "--json"])) as T;
}

async function newTask(
	repo: Repo,
): Promise<{ lane: number | null; takenBy: string | null }> {
	return readJson(repo, "task", "show", "3");
}

async function taskInBillingLane(repo: Repo, lane: number): Promise<boolean> {
	if ((await newTask(repo)).lane !== lane) {
		return false;
	}
	const board = await readJson<{ lanes: number[] }>(repo, "board", "show", "2");
	return board.lanes.includes(lane);
}
