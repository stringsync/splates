import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

/** Shipping a project from the Ships page. */
export const SHIPS_AREA: SetupArea = shipsArea();

function shipsArea(): SetupArea {
	const commandStep: SetupStep = {
		id: "ships-command",
		title: "Name how to ship",
		why: "The Ships page starts a release with the commands your project names, so it can publish, tag and cascade into the projects that depend on it. With none, nothing in this repository can be shipped from splates.",
		user: 'Have an agent add `ships: ["bin/<project> ship"]` to `splates.config.ts`; each command serves its targets through core/ship: approve its diff, restart the server, then press Next.',
		agent:
			"The page makes the change in a task named `setup-ships-command` and offers the restart: have the user approve it there, then run `splates setup ships-command`. Find the project's existing release script first, and never run the ship command yourself.",
		notDone:
			"`splates.config.ts` names no `ships` command yet: have an agent add one and approve it, then press Next.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "config",
				name: "ships",
				label: "Name the ship commands",
				change:
					'Add `ships: ["bin/<project> ship"]`, commands that serve their targets through core/ship, to `splates.config.ts`.',
			},
		],
		detail: async (machine) => {
			const commands = (await projectOf(machine).config()).ships;
			return commands.length === 0
				? null
				: `Ships are set up: ${commands.join(", ")} serve what the Ships page can ship.`;
		},
		check: async (machine) =>
			(await projectOf(machine).config()).ships.length > 0,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`ships` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server.",
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

const UNREAD =
	"No project to check: open Setup from a project, or run `splates setup` in its repository.";

function projectOf(machine: SetupMachine): SetupProject {
	if (machine.project === undefined) {
		throw new Error(UNREAD);
	}
	return machine.project;
}
