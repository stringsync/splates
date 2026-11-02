import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

const DOCS = "https://github.com/stringsync/splates/blob/main/docs/evals.md";

/** Showing a project's evals, from any framework, on the Evals page. */
export const EVALS_AREA: SetupArea = evalsArea();

function evalsArea(): SetupArea {
	const resultsStep: SetupStep = {
		id: "evals-results",
		title: "Show your evals",
		why: "Results from any eval framework (promptfoo, Inspect, a script of your own) can show on the Evals page once they are written in splates's results format (a `batch.json` and a `results.jsonl`, version `splates-evals/1`), which is how splates knows what passed.",
		user: `Have an agent add \`evals: { results: ".evals" }\` to this project's \`splates.config.ts\` in a task: approve its diff here, restart the server, then press Next. [How to write the results](${DOCS}).`,
		agent: `The page makes the \`evals\` change in a task named \`setup-evals-results\` and offers the restart: have the user approve it there, then run \`splates setup evals-results\`. The format is in ${DOCS}.`,
		notDone: `\`splates.config.ts\` names no \`evals.results\` yet: have an agent make the change above and approve it, then press Next. [The format](${DOCS}).`,
		optional: true,
		after: [],
		fields: [
			{
				kind: "config",
				name: "evals",
				label: "Name the results folder",
				change: `Add \`evals: { results: ".evals" }\` to \`splates.config.ts\`. [The format](${DOCS}).`,
			},
		],
		detail: async (machine) => {
			const evals = (await projectOf(machine).config()).evals;
			return evals === null
				? null
				: `Evals are set up: results are read from \`${evals.results}\`, and show on the Evals page.`;
		},
		check: async (machine) =>
			(await projectOf(machine).config()).evals !== null,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`evals` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server.",
				"The results already written: delete them if you no longer want them.",
			],
			run: async () => {},
		},
	};
	const runStep: SetupStep = {
		id: "evals-run",
		title: "Run evals from the page",
		why: "With `list` and `run` commands, the Evals page offers a run card that picks scenarios and starts a batch, instead of only showing results someone else wrote.",
		user: `Have an agent add \`list\` (prints the cases, one JSON object a line) and \`run\` (runs the cases in \`SPLATES_EVALS_CASES\` into a new batch under \`SPLATES_EVALS_RESULTS\`) to \`evals\` in \`splates.config.ts\`, and optionally a \`plan\` that prints what a run costs: approve its diff, restart the server, then press Next. [The commands](${DOCS}).`,
		agent: `The page makes the \`evals.list\` and \`evals.run\` change in a task named \`setup-evals-run\` and offers the restart: have the user approve it there, then run \`splates setup evals-run\`. Offer a \`plan\` too. The contract is in ${DOCS}.`,
		notDone: `\`evals\` in \`splates.config.ts\` names no \`list\` and \`run\` yet: have an agent add them and approve it, then press Next. [The commands](${DOCS}).`,
		optional: true,
		extra: true,
		after: [resultsStep],
		fields: [
			{
				kind: "config",
				name: "evals-run",
				label: "Name the list and run commands",
				change: `Add \`list\` and \`run\` (and, if it can price a run, \`plan\`) to \`evals\` in \`splates.config.ts\`. [The commands](${DOCS}).`,
			},
		],
		detail: async (machine) => {
			const evals = (await projectOf(machine).config()).evals;
			return evals?.list !== undefined && evals.run !== undefined
				? "Evals can be run from the page: pick scenarios on a run card and start a batch."
				: null;
		},
		check: async (machine) => {
			const evals = (await projectOf(machine).config()).evals;
			return evals?.list !== undefined && evals.run !== undefined;
		},
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`evals.list`, `evals.run` and `evals.plan` in this project's `splates.config.ts`: take them out in a task and merge it, then restart the server.",
			],
			run: async () => {},
		},
	};
	return {
		id: "evals",
		title: "Evals",
		purpose:
			"Show your project's evals on the Evals page, and run them from it.",
		steps: [resultsStep, runStep],
	};
}

/** What a step reads with no project open. */
const UNREAD =
	"No project to check: open Setup from a project, or run `splates setup` in its repository.";

function projectOf(machine: SetupMachine): SetupProject {
	if (machine.project === undefined) {
		throw new Error(UNREAD);
	}
	return machine.project;
}
