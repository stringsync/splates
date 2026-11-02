import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

/** Shipping a project from the Ships page. */
export const SHIPS_AREA: SetupArea = shipsArea();

function shipsArea(): SetupArea {
	const commandStep: SetupStep = {
		id: "ships-command",
		title: "Name how to ship",
		why: "The Ships page starts a release with the command your project names, so it can publish, tag and cascade into the projects that depend on it. With none, nothing in this repository can be shipped from splates.",
		user: "Have an agent add `ship` (the command that releases the project, run from the repository root, leaving the release committed and tagged on the trunk) to `splates.config.ts`, or `ships` for several targets, each with its `paths` and `ship`: approve its diff, restart the server, then press Next.",
		agent:
			"The page makes the change in a task named `setup-ships-command` and offers the restart: have the user approve it there, then run `splates setup ships-command`. Find the project's existing release script first, and never run the ship command yourself.",
		notDone:
			"`splates.config.ts` names no `ship` command or `ships` target yet: have an agent add one and approve it, then press Next.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "config",
				name: "ship",
				label: "Name the ship command",
				change:
					'Add `ship` (or `ships: { <name>: { paths: [...], ship: "..." } }` for several targets) to `splates.config.ts`.',
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
				"`ship` or `ships` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server.",
				"Releases already published: only the person can unpublish them.",
			],
			run: async () => {},
		},
	};
	const statusStep: SetupStep = {
		id: "ships-status",
		title: "Read live versions",
		why: "The Ships page shows what is live next to what is on the trunk. By default it reads npm's latest version of each public package; a `shipStatus` command reads it from anywhere else, such as a deploy.",
		user: "Skip this when the project ships to npm. Otherwise have an agent add `shipStatus` to `splates.config.ts`: a command printing `{ version, artifacts: [{ name, deployed }] }`. Approve its diff, restart the server, then press Next.",
		agent:
			"The page makes the change in a task named `setup-ships-status`: have the user approve it there, then run `splates setup ships-status`. Offer to skip it for an npm-only project.",
		notDone:
			"No `shipStatus` command is named: have an agent add one and approve it, or skip this when the project ships to npm.",
		optional: true,
		extra: true,
		after: [commandStep],
		fields: [
			{
				kind: "config",
				name: "shipStatus",
				label: "Name the status command",
				change:
					"Add `shipStatus`, a command printing `{ version, artifacts: [{ name, deployed }] }`, to `splates.config.ts`.",
			},
		],
		check: async (machine) =>
			(await projectOf(machine).config()).shipStatus !== null,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`shipStatus` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server.",
			],
			run: async () => {},
		},
	};
	return {
		id: "ships",
		title: "Ships",
		purpose: "Release your project from the Ships page.",
		steps: [commandStep, statusStep],
	};
}

/** The names of what the config can ship: the repository's own, then each target's. */
function shipped(
	config: Awaited<ReturnType<SetupProject["config"]>>,
): string[] {
	const targets = Object.entries(config.ships ?? {})
		.filter(([, target]) => target.ship !== null)
		.map(([name]) => name);
	return config.ship === null ? targets : ["this repository", ...targets];
}

const UNREAD =
	"No project to check: open Setup from a project, or run `splates setup` in its repository.";

function projectOf(machine: SetupMachine): SetupProject {
	if (machine.project === undefined) {
		throw new Error(UNREAD);
	}
	return machine.project;
}
