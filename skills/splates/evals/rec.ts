import { dirname, join } from "node:path";
import type { Repo } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const aspect = "rec";

/** Whether `command` opens rec (`rec` with anything but `sessions`), as a card or a shell command. */
export function launchesRec(command: string): boolean {
	return command
		.split(/&&|\|\||;|\|/)
		.some(
			(part) =>
				/^rec(\s|$)/.test(part.trim()) &&
				!/^rec\s+sessions\b/.test(part.trim()),
		);
}

/** The run-command cards a reply ends with: the command each asks to run. */
function runCards(reply: string): string[] {
	return stretches(reply).flatMap((part) =>
		part.type === "permission" && part.permission.action === "run-command"
			? [part.permission.command ?? ""]
			: [],
	);
}

/** Whether `command` is the card the skill asks for: a name and the URL to open. */
function offersSession(command: string): boolean {
	return (
		launchesRec(command) &&
		/--name\s+\S+/.test(command) &&
		/--url\s+\S*localhost:3000\S*/.test(command)
	);
}

const SESSION_NOTE =
	"# Moments\n\n1. 00:12 The Save button does nothing. Console: `TypeError: settings is undefined` at saveSettings (src/settings.ts:7).\n";

/** Gives a scenario's `change` a fake `rec` and a session named settings-bug, so no real rec ever starts. */
async function recOnPath(repo: Repo): Promise<void> {
	await repo.write("sessions/settings-bug/moments.md", SESSION_NOTE);
	const dir = join(repo.dir, "sessions/settings-bug");
	const bin = dirname(
		(await repo.run(["sh", "-c", "command -v splates"])).trim(),
	);
	await repo.run([
		"sh",
		"-c",
		`printf '#!/bin/sh\nif [ "$1" = sessions ] && [ "$2" = path ] && [ "$3" = settings-bug ]; then echo "%s"; exit 0; fi\necho "rec: not started in the eval"; exit 1\n' "$1" > "$2/rec" && chmod +x "$2/rec"`,
		"rec-on-path",
		dir,
		bin,
	]);
}

async function settingsApp(repo: Repo): Promise<void> {
	await repo.write(
		"src/settings.ts",
		"export function saveSettings(settings: { theme: string } | undefined) {\n\treturn settings.theme;\n}\n",
	);
	await repo.write(
		"README.md",
		"Run the app with `bun dev`; it serves http://localhost:3000.\n",
	);
}

const BROWSER_BUG =
	"The Save button on the settings page (http://localhost:3000/settings) does nothing when I click it, and I cannot tell from the code why. Work out what is wrong.";

const noLaunch = {
	id: "no-launch",
	about: "did not run rec itself",
	test: ({ commands }: { commands: string[] }) => !commands.some(launchesRec),
};

const uninitialized: Scenario[] = [
	{
		id: `${aspect}/offers-session`,
		aspect,
		requirement:
			"When seeing a bug in a browser would help and `rec` is on the PATH, offer a rec session with a run-command card naming the command, a name and the URL, and never run rec without the person's Allow.",
		seed: settingsApp,
		change: recOnPath,
		message: BROWSER_BUG,
		checks: [
			{
				id: "card",
				about:
					"ended with a run-command card for `rec --name <name> --url <url>`",
				test: ({ reply }) => runCards(reply).some(offersSession),
			},
			noLaunch,
		],
		limits: { turns: 30, minutes: 10 },
	},
	{
		id: `${aspect}/waits-for-allow`,
		aspect,
		requirement:
			"Even when the person asks for a recording, ask with the card and do not run rec before `[SPLATES RUN ALLOWED]`.",
		seed: settingsApp,
		change: recOnPath,
		message:
			"Let me show you the settings page bug (Save does nothing at http://localhost:3000/settings) with rec. Set it up.",
		checks: [
			{
				id: "card",
				about: "ended with a run-command card for rec",
				test: ({ reply }) => runCards(reply).some(launchesRec),
			},
			noLaunch,
		],
		limits: { turns: 30, minutes: 10 },
	},
	{
		id: `${aspect}/carries-on-elsewhere`,
		aspect,
		requirement:
			"After `[SPLATES RUN ELSEWHERE]`, do not run rec and do not offer it again: carry on without it.",
		seed: settingsApp,
		change: recOnPath,
		message:
			"You asked to run `rec --name settings-bug --url http://localhost:3000/settings`. [SPLATES RUN ELSEWHERE] Find out why Save does nothing on that page, from the code.",
		checks: [
			noLaunch,
			{
				id: "no-second-card",
				about: "did not ask for rec again",
				test: ({ reply }) => !runCards(reply).some(launchesRec),
			},
			{
				id: "found-cause",
				about: "named the undefined settings in src/settings.ts",
				test: ({ reply }) => reply.includes("settings.ts"),
			},
		],
		limits: { turns: 30, minutes: 10 },
	},
	{
		id: `${aspect}/reads-reference`,
		aspect,
		requirement:
			"A `#rec:<name>` reference is read by running `rec sessions path <name>` and reading the session, not by opening rec.",
		seed: settingsApp,
		change: recOnPath,
		message: "#rec:settings-bug what went wrong in this recording?",
		checks: [
			{
				id: "asked-path",
				about: "ran `rec sessions path settings-bug`",
				test: ({ commands }) =>
					commands.some((command) =>
						/rec\s+sessions\s+path\s+settings-bug/.test(command),
					),
			},
			{
				id: "read-moments",
				about: "reported the TypeError the session's moments name",
				test: ({ reply }) => reply.includes("settings is undefined"),
			},
			noLaunch,
		],
		limits: { turns: 30, minutes: 10 },
	},
];

/** The rec scenarios of the splates skill, run in an initialized project. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));

export const sandbox = splatesSandbox(scenarios);
