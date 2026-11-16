import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

/** Shipping a project from the Ships page. */
export const SHIPS_AREA: SetupArea = shipsArea();

function shipsArea(): SetupArea {
	const commandStep: SetupStep = {
		id: "ships-command",
		title: "Name how to ship",
		why: "The Ships page starts a release with the command your project names, so it can publish, tag and cascade into the projects that depend on it. With none, nothing in this repository can be shipped from splates.",
		user: 'Have an agent add `legacyShips: { <name>: { ship: "...", after: [] } }` to `splates.config.ts`; the command must serve `plan --json`, `status --json` and run through the core/legacy-ship ShipCommand wrapper: approve its diff, restart the server, then press Next.',
		agent:
			"The page makes the change in a task named `setup-ships-command` and offers the restart: have the user approve it there, then run `splates setup ships-command`. Find the project's existing release script first, and never run the ship command yourself.",
		notDone:
			"`splates.config.ts` names no `ship` command or `legacyShips` target yet: have an agent add one and approve it, then press Next.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "config",
				name: "ship",
				label: "Name the ship command",
				change:
					'Add `legacyShips: { <name>: { ship: "...", after: [] } }` using a core/legacy-ship command wrapper to `splates.config.ts`.',
			},
		],
		detail: async (machine) => {
			const names = shipped(await projectOf(machine).config());
			return names.length === 0
				? null
				: `Ships are set up: ${names.join(", ")} can be shipped from the Ships page.`;
		},
		check: async (machine) =>
			shipped(await projectOf(machine).config()).length > 0,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`ship` or `legacyShips` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server.",
				"Releases already published: only the person can unpublish them.",
			],
			run: async () => {},
		},
	};
	return {
		id: "ships",
		title: "Ships",
		purpose: "Release your project from the Ships page.",
		steps: [commandStep],
	};
}

/** The names of what the config can ship: the repository's own, then each target's. */
function shipped(
	config: Awaited<ReturnType<SetupProject["config"]>>,
): string[] {
	const targets = Object.entries(config.legacyShips ?? {})
		.filter(([, target]) => target.ship !== null)
		.map(([name]) => name);
	return targets;
}

const UNREAD =
	"No project to check: open Setup from a project, or run `splates setup` in its repository.";

function projectOf(machine: SetupMachine): SetupProject {
	if (machine.project === undefined) {
		throw new Error(UNREAD);
	}
	return machine.project;
}
