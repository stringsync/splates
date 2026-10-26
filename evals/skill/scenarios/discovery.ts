import type { Check, Repo, Scenario, Step } from "../scenario";

const aspect = "discovery";

/** The index of the first tool step whose target `test` accepts, or -1. */
export function firstStep(
	transcript: Step[],
	test: (target: string) => boolean,
): number {
	return transcript.findIndex(
		(step) => step.kind === "tool" && test(target(step)),
	);
}

/** What a tool step reads or runs, as text: the shell command or the file path. */
function target(step: Step): string {
	if (step.kind !== "tool") {
		return "";
	}
	try {
		const input = JSON.parse(step.input) as Record<string, unknown>;
		const text = input.command ?? input.file_path ?? input.path;
		return typeof text === "string" ? text : step.input;
	} catch {
		return step.input;
	}
}

/** Whether a step opens `path`: a read tool on it, or a shell command that cats it. */
export function opens(path: string): (target: string) => boolean {
	return (text) => text.includes(path);
}

/**
 * Whether the transcript opens a file matching `first` before the first step
 * matching `second`; true when `first` comes up and `second` never does.
 */
export function readBefore(
	transcript: Step[],
	first: (target: string) => boolean,
	second: (target: string) => boolean,
): boolean {
	const read = firstStep(transcript, first);
	if (read === -1) {
		return false;
	}
	const acted = firstStep(transcript, second);
	return acted === -1 || read < acted;
}

const message = "Fix the greeting in src/message.ts.";
const named = " Use message as the task name and Fix the greeting as its goal.";

async function greeter(repo: Repo): Promise<void> {
	await repo.write("src/message.ts", 'export const greeting = "helo";\n');
}

const startsTask = (target: string) =>
	/\bsplates\s+add\s+message\b/.test(target);

const taskStarted: Check = {
	id: "task-listed",
	about: "`splates list` names the message task afterwards",
	test: async ({ repo }) =>
		(await repo.run(["splates", "list"])).includes("message"),
};

const addBeforeCode: Check = {
	id: "add-before-code",
	about: "started the task with `splates add` before opening src/message.ts",
	test: ({ transcript }) => {
		const added = firstStep(transcript, startsTask);
		const looked = firstStep(
			transcript,
			(text) => !startsTask(text) && text.includes("src/message.ts"),
		);
		return added !== -1 && (looked === -1 || added < looked);
	},
};

const readsSkill: Check = {
	id: "read-skill",
	about: "opened the skill before the code",
	test: ({ transcript }) =>
		readBefore(transcript, opens("skills/splates"), opens("src/message.ts")) ||
		// A client that loads the skill itself shows no read; the add check covers it.
		firstStep(transcript, startsTask) !== -1,
};

const uninitialized: Scenario[] = [
	{
		id: "discovery/implicit",
		aspect,
		requirement:
			"With no mention of the skill, a coding request in a splates repository still leads the agent to the splates skill: it starts a task with `splates add` before investigating the code.",
		seed: greeter,
		message: message + named,
		checks: [addBeforeCode, readsSkill, taskStarted],
	},
	{
		id: "discovery/explicit",
		aspect,
		requirement:
			"When the person names the skill with `$splates`, the agent uses it: it starts a task with `splates add` before investigating the code.",
		seed: greeter,
		message: `Use $splates to fix the greeting in src/message.ts.${named}`,
		checks: [addBeforeCode, readsSkill, taskStarted],
	},
	{
		id: "discovery/queue",
		aspect,
		requirement:
			"Before queueing a follow-up task, read references/queue.md, which the skill points to, then queue it with `splates task add` and do not implement it.",
		seed: greeter,
		message:
			'Record a follow-up: the greeting in src/message.ts has a typo, "helo". Queue it as a task for later; do not fix it now.',
		checks: [
			{
				id: "queue-read-first",
				about: "read references/queue.md before `splates task add` or `defer`",
				test: ({ transcript }) =>
					readBefore(transcript, opens("references/queue.md"), (text) =>
						/\bsplates\s+task\s+(add|defer)\b/.test(text),
					),
			},
			{
				id: "queued",
				about: "ran `splates task add` or `defer`",
				test: ({ commands }) =>
					commands.some((command) =>
						/\bsplates\s+task\s+(add|defer)\b/.test(command),
					),
			},
			{
				id: "not-fixed",
				about: "left src/message.ts unchanged",
				test: async ({ repo }) =>
					(await repo.run(["cat", "src/message.ts"])).includes('"helo"'),
			},
		],
	},
	{
		id: "discovery/checkpoint",
		aspect,
		requirement:
			"On `[SPLATES CHECKPOINT]` the agent reads references/checkpoint.md, which the skill points to, before it updates SPLATES.md.",
		seed: greeter,
		message: "[SPLATES CHECKPOINT]",
		checks: [
			{
				id: "checkpoint-read",
				about: "opened references/checkpoint.md",
				test: ({ transcript }) =>
					firstStep(transcript, opens("references/checkpoint.md")) !== -1,
			},
		],
	},
	{
		id: "discovery/setup",
		aspect,
		requirement:
			"On `[SPLATES SETUP <step>]` the agent reads references/setup.md, which the skill points to, before it runs `splates setup`.",
		seed: greeter,
		message: "[SPLATES SETUP agents]",
		checks: [
			{
				id: "setup-read-first",
				about: "read references/setup.md before running `splates setup`",
				test: ({ transcript }) =>
					readBefore(transcript, opens("references/setup.md"), (text) =>
						/\bsplates\s+setup\b/.test(text),
					),
			},
		],
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
