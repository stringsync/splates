import { readdir } from "node:fs/promises";
import type { AsyncResource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Child, Ps } from "webappwiz/system";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Document, Storage } from "../storage";

/** `claude:MODEL@EFFORT` for a pick, as `--agent` takes it. */
export function targetOf(pick: AgentPick): string {
	return `${pick.agent}${pick.model === undefined ? "" : `:${pick.model}`}${
		pick.effort === undefined ? "" : `@${pick.effort}`
	}`;
}

/** A project's eval commands, from the `evals` block of its `splates.config.ts`. */
export interface EvalCommands {
	/** The project's root, where the commands run when a run names no worktree. */
	root: string;
	/** Where batches are written, absolute, as `SPLATES_EVALS_RESULTS` tells `run`. */
	results: string;
	/** Prints the cases, one JSON object a line; null when the project names none. */
	list: string | null;
	/** Runs the cases and targets in the env into a new batch; null when the project names none. */
	run: string | null;
	/** Prints what a run would come to and cost at most; null when the project names none. */
	plan: string | null;
}

/** What the person's Run button asks for: the evals of one card, on the agents it ended with. */
export interface EvalLaunchSpec {
	/** Names the card, so a reload finds its run again. */
	key: string;
	/** The card's label, the skill or suite it names. */
	skill: string;
	scenarios: string[];
	agents: AgentPick[];
	/** The revision the change is judged against; the runner's own default when null. */
	baseline: string | null;
	/** Runs of each cell; the runner's own default when absent. */
	reps?: number;
	/** The conversation whose card it is, told once it is done; null for none. */
	conversation?: string | null;
	/** Where the commands run, the conversation's task worktree; the project's root when null. */
	cwd?: string | null;
}

/** How a launch stands. `refused` is the runner declining before it wrote a batch. */
export type EvalLaunchStatus = "running" | "done" | "refused" | "stopped";

/** A launch as the card reads it. */
export interface EvalLaunch {
	id: string;
	key: string;
	status: EvalLaunchStatus;
	/** The batch directory it writes, once the runner has made it. */
	batch: string | null;
	/** The runner's last words: a refusal's reason. */
	output: string;
}

/** What a project's `plan` says a run comes to; without one, nothing is known of its cost. */
export interface EvalPlan {
	/** Case-by-target runs the plan comes to; null when the project prints no plan. */
	cells: number | null;
	/** The most they can cost, in dollars; null when there is no ceiling to show. */
	usd: number | null;
	/** Whether the plan turned the run down, its reason in `output`. */
	refused: boolean;
	/** The planner's output, for a refusal or anything the numbers leave out. */
	output: string;
}

/** A case a project's `list` prints. */
export interface EvalScenario {
	id: string;
	/** What the card heads the case with, as `group` in `batch.json`. */
	group: string | null;
	/** What the case checks, as `about` in `batch.json`. */
	about: string | null;
}

const TAIL = 20;

/**
 * Starts, follows and stops the paid runs the Evals card asks for, through
 * the `list`, `plan` and `run` commands a project names. Listen to `running`
 * to show a conversation's card run as going, and to `finished` to tell the
 * conversation its results. A restart runs again each launch left in progress.
 */
export class EvalLaunches
	implements Eventful<EvalLaunchesEvents>, AsyncResource
{
	private readonly dispatcher = new Dispatcher<EvalLaunchesEvents>();
	readonly events = this.dispatcher.events;
	/** By project root and card key. */
	private readonly launches = new Map<string, Launched>();
	private readonly watching = new Set<Promise<void>>();
	private readonly record: Document<Record<string, SavedLaunch>>;
	private writing: Promise<void> = Promise.resolve();
	private disposing = false;

	constructor(
		private readonly ps: Ps,
		storage: Storage,
	) {
		this.record = storage.document("eval-launches.json");
	}

	/** Every case the project's `list` prints. */
	async scenarios(
		commands: EvalCommands,
		cwd: string | null = null,
	): Promise<EvalScenario[]> {
		if (commands.list === null) {
			return [];
		}
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
			["sh", "-c", commands.list],
			{ cwd: cwd ?? commands.root },
		);
		if (exitCode !== 0) {
			fail(
				"hook_failed",
				tailOf(`${stdout}${stderr}`) || `evals.list exited ${exitCode}`,
				{},
			);
		}
		return stdout.split("\n").flatMap((line) => {
			const each = parsed(line);
			return each === null || typeof each.case !== "string" || each.case === ""
				? []
				: [
						{
							id: each.case,
							group: typeof each.group === "string" ? each.group : null,
							about: typeof each.about === "string" ? each.about : null,
						},
					];
		});
	}

	/** Runs the project's free `plan` for `spec`; without one, nothing is refused and no ceiling shown. */
	async plan(
		commands: EvalCommands,
		spec: Omit<EvalLaunchSpec, "key">,
	): Promise<EvalPlan> {
		if (commands.plan === null) {
			return { cells: null, usd: null, refused: false, output: "" };
		}
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
			["sh", "-c", commands.plan],
			{ cwd: spec.cwd ?? commands.root, env: envOf(commands, spec) },
		);
		const said = stdout
			.split("\n")
			.map(parsed)
			.findLast((each) => each !== null);
		const number = (value: unknown): number | null =>
			typeof value === "number" && Number.isFinite(value) ? value : null;
		return {
			cells: number(said?.cells),
			usd: exitCode === 0 ? number(said?.usd) : null,
			refused: exitCode !== 0,
			output: tailOf(`${stdout}${stderr}`),
		};
	}

	/** Starts `spec`, unless its card already has a run going. */
	async start(
		commands: EvalCommands,
		spec: EvalLaunchSpec,
	): Promise<EvalLaunch> {
		if (commands.run === null) {
			fail(
				"not_found",
				"this project names no evals.run in splates.config.ts",
				{},
			);
		}
		const id = idOf(commands, spec.key);
		const held = this.launches.get(id);
		if (held !== undefined && held.status === "running") {
			return this.read(held);
		}
		const known = new Set(await batchesIn(commands.results));
		const child = this.ps.start(["sh", "-c", commands.run], {
			cwd: spec.cwd ?? commands.root,
			env: envOf(commands, spec),
		});
		const launch: Launched = {
			id: crypto.randomUUID(),
			key: spec.key,
			status: "running",
			batch: null,
			output: "",
			recordId: id,
			commands,
			spec,
			child,
			known,
			stopping: false,
		};
		this.launches.set(id, launch);
		try {
			await this.save(launch, true);
		} catch (error) {
			this.launches.delete(id);
			launch.child.kill();
			throw error;
		}
		this.running(launch);
		const watching = this.watch(launch);
		this.watching.add(watching);
		void watching.then(
			() => this.watching.delete(watching),
			() => {},
		);
		return this.read(launch);
	}

	/** Runs again each launch a stopped server left in progress. */
	async resume(commands: EvalCommands[]): Promise<void> {
		const current = new Map(commands.map((each) => [each.root, each]));
		for (const [id, saved] of Object.entries(
			(await this.record.read()) ?? {},
		)) {
			if (
				saved.launch.status !== "running" ||
				this.launches.get(id)?.status === "running"
			) {
				continue;
			}
			const commandsNow = current.get(saved.commands.root);
			if (commandsNow?.run != null) {
				await this.start(commandsNow, saved.spec);
			}
		}
	}

	/** The run of the card `key` names, or null when it has none. */
	async get(commands: EvalCommands, key: string): Promise<EvalLaunch | null> {
		const id = idOf(commands, key);
		const launch = this.launches.get(id);
		return launch === undefined
			? ((await this.record.read())?.[id]?.launch ?? null)
			: this.read(launch);
	}

	/** Stops the run of the card `key` names; its landed cells stay on the Evals page. */
	async stop(commands: EvalCommands, key: string): Promise<EvalLaunch | null> {
		const launch = this.launches.get(idOf(commands, key));
		if (launch === undefined) {
			return null;
		}
		if (launch.status === "running") {
			launch.stopping = true;
			launch.child.kill();
		}
		return this.read(launch);
	}

	/** Stops runners and waits for their writes, leaving interrupted runs in progress to resume. */
	async disposeAsync(): Promise<void> {
		this.disposing = true;
		for (const launch of this.launches.values()) {
			if (launch.status === "running") {
				launch.child.kill();
			}
		}
		await Promise.all(this.watching);
	}

	/** Collects the child's words and settles the launch when it exits. */
	private async watch(launch: Launched): Promise<void> {
		const words = [launch.child.stdout, launch.child.stderr].map(
			async (stream) => {
				for await (const text of decoded(stream)) {
					launch.output = tailOf(launch.output + text);
				}
			},
		);
		const code = await launch.child.exited;
		await Promise.all(words);
		await this.read(launch);
		if (this.disposing && !launch.stopping) {
			return;
		}
		launch.status = launch.stopping
			? "stopped"
			: code === 0
				? "done"
				: launch.batch === null
					? "refused"
					: "done";
		await this.save(launch);
		if (
			launch.status === "done" &&
			launch.batch !== null &&
			launch.spec.conversation != null
		) {
			// Whoever tells the conversation ends its run once it has.
			this.dispatcher.dispatch("finished", {
				launch: viewOf(launch),
				results: launch.commands.results,
				conversation: launch.spec.conversation,
			});
		} else {
			this.running(launch);
		}
	}

	/** Says whether any run from `launch`'s conversation is still going. */
	private running(launch: Launched): void {
		const conversation = launch.spec.conversation;
		if (conversation == null) {
			return;
		}
		this.dispatcher.dispatch("running", {
			conversation,
			running: [...this.launches.values()].some(
				(each) =>
					each.status === "running" && each.spec.conversation === conversation,
			),
		});
	}

	/** The launch, its batch found if the runner has made one since it started. */
	private async read(launch: Launched): Promise<EvalLaunch> {
		if (launch.batch === null) {
			const made = (await batchesIn(launch.commands.results)).filter(
				(each) => !launch.known.has(each),
			);
			launch.batch = made.sort().at(-1) ?? null;
			if (launch.batch !== null) {
				await this.save(launch);
			}
		}
		return viewOf(launch);
	}

	private save(launch: Launched, replace = false): Promise<void> {
		const saved: SavedLaunch = {
			launch: viewOf(launch),
			commands: launch.commands,
			spec: launch.spec,
		};
		const writing = this.writing.then(async () => {
			await this.record.update((current) => {
				const all = current ?? {};
				if (!replace && all[launch.recordId]?.launch.id !== launch.id) {
					return all;
				}
				return { ...all, [launch.recordId]: saved };
			});
		});
		this.writing = writing.catch(() => {});
		return writing;
	}
}

/**
 * What a project's `plan` and `run` are told, as the evals docs lay out: the
 * cases and targets a line each, where to write, and the card's repetitions
 * and baseline when it names them.
 */
function envOf(
	commands: EvalCommands,
	spec: Omit<EvalLaunchSpec, "key">,
): Record<string, string> {
	return {
		SPLATES_EVALS_CASES: spec.scenarios.join("\n"),
		SPLATES_EVALS_TARGETS: spec.agents.map(targetOf).join("\n"),
		SPLATES_EVALS_RESULTS: commands.results,
		...(spec.reps === undefined
			? {}
			: { SPLATES_EVALS_REPS: String(spec.reps) }),
		...(spec.baseline === null
			? {}
			: { SPLATES_EVALS_BASELINE: spec.baseline }),
	};
}

function idOf(commands: EvalCommands, key: string): string {
	return `${commands.root}\n${key}`;
}

/** The batch directories `results` holds. */
async function batchesIn(results: string): Promise<string[]> {
	return (await readdir(results, { withFileTypes: true }).catch(() => []))
		.filter((each) => each.isDirectory())
		.map((each) => each.name);
}

/** The JSON object `line` holds, or null for anything else. */
function parsed(line: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(line);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function viewOf(launch: Launched): EvalLaunch {
	return {
		id: launch.id,
		key: launch.key,
		status: launch.status,
		batch: launch.batch,
		output: launch.output,
	};
}

/** A run that finished with its batch written, for the conversation whose card started it. */
export interface EvalFinished {
	launch: EvalLaunch;
	/** The directory the batch is in. */
	results: string;
	conversation: string;
}

/** Whether a conversation has a run its card started going, as one starts or ends. */
export interface EvalRunning {
	conversation: string;
	running: boolean;
}

export type EvalLaunchesEvents = {
	// No `running` follows it: whoever tells the conversation ends its run.
	finished: EvalFinished;
	running: EvalRunning;
};

interface SavedLaunch {
	launch: EvalLaunch;
	commands: EvalCommands;
	spec: EvalLaunchSpec;
}

interface Launched extends EvalLaunch {
	recordId: string;
	commands: EvalCommands;
	spec: EvalLaunchSpec;
	child: Child;
	known: Set<string>;
	stopping: boolean;
}

async function* decoded(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	for await (const chunk of stream) {
		yield decoder.decode(chunk, { stream: true });
	}
}

/** The last lines of `text`. */
function tailOf(text: string): string {
	return text.trim().split("\n").slice(-TAIL).join("\n");
}
