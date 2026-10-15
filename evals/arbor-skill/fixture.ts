import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndState } from "@webappwiz/arbor/skill-checks";
import { $, type ShellExpression } from "bun";
import type { Scenario } from "./scenario";

/**
 * A throwaway arbor repository for one run: an uploader whose retries never
 * stop, the skill under test installed as `arbor init` would, and a lane of
 * todos seeded. Every `arbor` it runs, and every one its agent runs, is this
 * checkout's, with its own `ARBOR_HOME`, so nothing reaches the user's.
 */
export class Fixture {
	readonly repo: string;
	private readonly env: Record<string, string | undefined>;

	constructor(
		/** Emptied, then holds the repository, its arbor home and the `arbor` on its PATH. */
		readonly dir: string,
		/** The skill under test, as a directory holding SKILL.md. */
		private readonly skill: string,
	) {
		this.repo = join(dir, "repo");
		this.env = {
			...process.env,
			ARBOR_HOME: join(dir, "home"),
			PATH: `${join(dir, "bin")}:${process.env.PATH}`,
			// Left set, these would tie the run to the conversation that started it.
			ARBOR_CONVERSATION: undefined,
			ARBOR_DEV: undefined,
			ARBOR_CALLER: undefined,
			CLAUDECODE: undefined,
		};
	}

	async create(scenario: Scenario): Promise<void> {
		await rm(this.dir, { recursive: true, force: true });
		await mkdir(join(this.dir, "bin"), { recursive: true });
		await writeFile(
			join(this.dir, "bin", "arbor"),
			`#!/bin/sh\nexec bun ${ARBOR} "$@"\n`,
			{ mode: 0o755 },
		);
		await mkdir(join(this.repo, "src"), { recursive: true });
		for (const [path, text] of Object.entries(FILES)) {
			await writeFile(join(this.repo, path), text);
		}
		const sh = this.sh.bind(this);
		await sh`git init -q -b main && git config user.name Eval && git config user.email eval@example.com`;
		await sh`git add -A && git commit -qm ${"Upload with retries"}`;
		// Linked, as this repository links its own, so `arbor init` leaves the
		// skill under test as it is rather than fetching a release over it.
		const skill = join(this.dir, "skill");
		await sh`cp -R ${this.skill} ${skill} && mkdir -p .agents/skills && ln -s ${skill} .agents/skills/arbor`;
		await sh`arbor init`;
		await sh`mkdir -p .claude/skills && ln -s ../../.agents/skills/arbor .claude/skills/arbor`;
		await sh`git add -A && git commit -qm ${"Add the arbor skill"}`;
		await sh`arbor lane add ${"Upload errors"}`;
		for (const todo of TODOS) {
			await sh`arbor todo add ${todo.subject} ${todo.detail} ${todo.flags}`;
		}
		if (scenario.setup !== undefined) {
			await sh`sh -c ${scenario.setup}`;
		}
		const todos = JSON.parse(
			await sh`arbor todo list --json`.text(),
		) as unknown[];
		if (todos.length !== TODOS.length) {
			throw new Error(
				`the fixture seeded ${todos.length} todos, not ${TODOS.length}`,
			);
		}
	}

	/** One turn of `claude -p`, resuming the session `resume` names; what it printed, line by line. */
	async turn(prompt: string, opts: TurnOptions): Promise<string[]> {
		const resume = opts.resume === undefined ? [] : ["--resume", opts.resume];
		const out = await this
			.sh`claude -p ${prompt} ${resume} --model ${opts.model} --output-format stream-json --verbose --dangerously-skip-permissions --setting-sources project --strict-mcp-config`.nothrow();
		return out.stdout.toString().split("\n").filter(Boolean);
	}

	/** Where the repository stands once the agent is done, for the checks to read. */
	async end(): Promise<EndRepo> {
		const sh = (strings: TemplateStringsArray, ...values: ShellExpression[]) =>
			this.sh(strings, ...values).nothrow();
		const json = async (command: string[]) =>
			JSON.parse((await sh`arbor ${command} --json`.text()) || "null");
		const tasks = ((await json(["list"])) ?? []) as { task: string }[];
		const outcomes = (
			await sh`cat ${join(this.dir, "home", "outcomes.jsonl")}`.text()
		)
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Outcome);
		return {
			tasks: await Promise.all(tasks.map(({ task }) => json(["show", task]))),
			todos: (await json(["todo", "list"])) ?? [],
			lanes: (await json(["lane", "list"])) ?? [],
			systems: (await sh`cat arbor.systems.ts`).exitCode === 0,
			main: (await sh`git log --format=%B%x00 ${"main"}`.text())
				.split("\0")
				.map((message) => message.trim())
				.filter(Boolean),
			landed: outcomes.flatMap((each) =>
				each.ended === "merged" && each.commits !== undefined
					? [{ task: each.task, base: each.base, commits: each.commits }]
					: [],
			),
		};
	}

	/** A command run in the repository, quietly, throwing when it fails. */
	private sh(strings: TemplateStringsArray, ...values: ShellExpression[]) {
		return this.shell(strings, ...values).quiet();
	}

	private get shell() {
		return new $.Shell().cwd(this.repo).env(this.env);
	}
}

export interface TurnOptions {
	/** As `claude --model` takes it. */
	model: string;
	/** The session to resume, for a turn after the first. */
	resume?: string;
}

/** What the checks read of a repository once a run is done. */
export interface EndRepo extends EndState {
	landed: { task: string; base: string; commits: string[] }[];
	/** `arbor show --json` of each task left. */
	tasks: Task[];
	/** `arbor todo list --json`. */
	todos: Record<string, unknown>[];
	/** `arbor lane list --json`. */
	lanes: Record<string, unknown>[];
	/** Whether `arbor.systems.ts` exists. */
	systems: boolean;
	/** Each commit message on main, newest first. */
	main: string[];
}

/** What the checks read of `arbor show --json`. */
export interface Task {
	task: string;
	status: string;
	base: string;
	/** Its ARBOR.md; null when it has none. */
	plan: string | null;
}

interface Outcome {
	task: string;
	base: string;
	ended: string;
	commits?: string[];
}

const ARBOR = join(import.meta.dir, "../../packages/arbor/index.ts");

const FILES: Record<string, string> = {
	"package.json": `{ "name": "uploader", "private": true, "type": "module", "scripts": { "test": "bun test" } }\n`,
	"arbor.config.ts": `export default { preMerge: "bun test" };\n`,
	"CLAUDE.md": `Use the arbor skill for any work that may change code: start a task with
\`arbor add\` before investigating, and land it with \`arbor merge\`.

Run \`bun test\` after making code changes.

This session runs in print mode and ends with your turn, so run every
subagent in the foreground and wait for it.
`,
	"src/upload.ts": `/** Sends a file, retrying until the server accepts it. */
export async function upload(
	send: () => Promise<number>,
	tell: (message: string) => void = console.error,
): Promise<void> {
	for (;;) {
		const status = await send();
		if (status < 400) return;
		tell(\`upload failed with \${status}, retrying\`);
	}
}
`,
	"src/upload.test.ts": `import { expect, it } from "bun:test";
import { upload } from "./upload";

it("returns once the server accepts", async () => {
	let calls = 0;
	await upload(async () => (++calls < 3 ? 500 : 200), () => {});
	expect(calls).toBe(3);
});
`,
};

/** The commits on main before the agent starts. */
export const SEEDED = 2;

/** Seeded in order, so #1 and #3 make lane 1 and #2 is untriaged. */
const TODOS = [
	{
		subject: "Upload retries forever on a 413",
		detail: `The client retries on any status of 400 or more in \`src/upload.ts\`, so a file the server refuses as too big (413) retries forever.

- [ ] stop retrying on 413
- [ ] tell the user the file is too big`,
		flags: ["--lane", "1"],
	},
	{
		subject: "Rename the export menu",
		detail: `The menu says "Export as…"; it should say "Download".`,
		flags: [],
	},
	{
		subject: "Stop retrying other client errors",
		detail:
			"After the 413 fix, stop retrying every 4xx except 408 and 429 in `src/upload.ts`.",
		flags: ["--lane", "1", "--blocked-by", "1"],
	},
];
