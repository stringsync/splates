import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

const DOCS = "https://github.com/stringsync/splates/blob/main/docs/evals.md";

/** Showing a project's evals, from any framework, on the Evals page. */
export const EVALS_AREA: SetupArea = evalsArea();

function evalsArea(): SetupArea {
	const resultsStep: SetupStep = {
		id: "evals-results",
		title: "Show your evals",
		why: "Results from any eval framework (promptfoo, Inspect, a script of your own) can show on the Evals page once they are written in the `splates-evals/1` format.",
		user: `Add \`evals: { results: ".evals" }\` to this project's \`splates.config.ts\` and merge it, as a task, then restart \`splates server\` and press Next. [How to write the results](${DOCS}).`,
		agent: `In a task of its own, add the \`evals\` the user names to \`splates.config.ts\` and merge it; then have the user restart \`splates server\`, and run \`splates setup evals-results\`. The format is in ${DOCS}.`,
		notDone: `\`splates.config.ts\` names no \`evals.results\` yet: add it, merge it, then press Next. [The format](${DOCS}).`,
		optional: true,
		after: [],
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
				"`evals` in this project's `splates.config.ts`: take it out in a task and merge it, then restart `splates server`.",
				"The results already written: delete them if you no longer want them.",
			],
			run: async () => {},
		},
	};
	return { id: "evals", title: "Evals", steps: [resultsStep] };
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
