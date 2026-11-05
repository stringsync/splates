import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AsyncResource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import type { Child, Ps } from "core/system";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Document, Storage } from "../storage";
import { type EvalBudgetStatus, EvalBudgets, gate } from "./budget";
import { parsed, parseScenarioList } from "./scenario-list";
import { EvalStore } from "./store";
import { targetOf } from "./target";

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
	/** The dollar budget and round cap of each conversation, and the rounds it started. */
	readonly budgets: EvalBudgets;
	private writing: Promise<void> = Promise.resolve();
	private disposing = false;

	constructor(
		private readonly ps: Ps,
		private readonly storage: Storage,
	) {
		this.record = storage.document("eval-launches.json");
		this.budgets = new EvalBudgets(storage.document("eval-budgets.json"));
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
		return parseScenarioList(stdout);
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
		// Serialize starts across cards and server instances before spending.
		const lock = this.storage.lock("eval-launch-start");
		await lock.acquire();
		try {
			return await this.startLocked(commands, spec);
		} finally {
			await lock.release();
		}
	}

	private async startLocked(
		commands: EvalCommands,
		spec: EvalLaunchSpec,
	): Promise<EvalLaunch> {
		const id = idOf(commands, spec.key);
		const held = this.launches.get(id);
		if (held !== undefined && held.status === "running") {
			return this.read(held);
		}
		const conversation = spec.conversation ?? null;
		let worstUsd = 0;
		if (conversation !== null) {
			const plan = await this.plan(commands, spec);
			worstUsd = plan.usd ?? 0;
			await this.checkBudget(commands, conversation, worstUsd);
		}
		const known = new Set(await batchesIn(commands.results));
		const reserved: SavedLaunch = {
			launch: {
				id: crypto.randomUUID(),
				key: spec.key,
				status: "running",
				batch: null,
				output: "",
			},
			commands,
			spec,
		};
		// Persist the request before a process can spend, including a crash during spawn.
		await this.record.update((all) => ({ ...all, [id]: reserved }));
		if (conversation !== null) {
			await this.budgets.begin(conversation, {
				launch: reserved.launch.id,
				worstUsd,
				batch: null,
			});
		}
		const child = this.ps.start(["sh", "-c", commands.run as string], {
			cwd: spec.cwd ?? commands.root,
			env: envOf(commands, spec),
		});
		const launch: Launched = {
			...reserved.launch,
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

	/** Where the conversation's budget stands: spend, rounds used and any limit reached. */
	budgetStatus(
		commands: EvalCommands,
		conversation: string,
	): Promise<EvalBudgetStatus> {
		return this.budgets.statusOf(conversation, new EvalStore(commands.results));
	}

	/**
	 * Refuses with `budget_exhausted`, naming the limit, when a run of at most
	 * `worstUsd` does not fit what the conversation has left. A round whose batch
	 * has no cost yet counts as spending nothing.
	 */
	private async checkBudget(
		commands: EvalCommands,
		conversation: string,
		worstUsd: number,
	): Promise<void> {
		const {
			budget,
			spentUsd: spent,
			roundsUsed,
		} = await this.budgetStatus(commands, conversation);
		const verdict = gate(budget, spent, roundsUsed, worstUsd);
		if (!verdict.ok) {
			fail("budget_exhausted", verdict.reason, { limit: verdict.limit });
		}
	}

	/** Recover saved launches after a server restart without rerunning paid commands. */
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
		const id = await this.resolveId(commands, key);
		const launch = this.launches.get(id);
		return launch === undefined
			? ((await this.record.read())?.[id]?.launch ?? null)
			: this.read(launch);
	}

	/** Saved ownership of batches in this results directory, including earlier rounds of a card. */
	async batchConversations(results: string): Promise<Map<string, string>> {
		const owners = new Map<string, string>();
		for (const saved of Object.values((await this.record.read()) ?? {})) {
			const conversation = saved.spec.conversation;
			if (saved.commands.results !== results || conversation == null) {
				continue;
			}
			if (saved.launch.batch !== null) {
				owners.set(saved.launch.batch, conversation);
			}
			for (const round of await this.budgets.roundsOf(conversation)) {
				if (round.batch !== null) {
					owners.set(round.batch, conversation);
				}
			}
		}
		return owners;
	}

	/** Stops the run of the card `key` names; its landed cells stay on the Evals page. */
	async stop(commands: EvalCommands, key: string): Promise<EvalLaunch | null> {
		const launch = this.launches.get(await this.resolveId(commands, key));
		if (launch === undefined) {
			return null;
		}
		if (launch.status === "running") {
			launch.stopping = true;
			launch.child.kill();
		}
		return this.read(launch);
	}

	private async resolveId(
		commands: EvalCommands,
		key: string,
	): Promise<string> {
		const id = idOf(commands, key);
		return (
			(
				await this.storage
					.document<Record<string, string>>("eval-launch-aliases.json")
					.read()
			)?.[id] ?? id
		);
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
		if (launch.status === "refused" && launch.spec.conversation != null) {
			// A refusal spent nothing, so it is no round.
			await this.budgets.refund(launch.spec.conversation, launch.id);
		}
		if (
			(launch.status === "done" || launch.status === "stopped") &&
			launch.batch !== null &&
			launch.spec.conversation != null
		) {
			// A stopped run reports what landed too, so the agent is never left
			// waiting on a run that will not say it is over.
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
			const claimed = new Set(
				[...this.launches.values()]
					.filter(
						(each) =>
							each !== launch && each.commands.root === launch.commands.root,
					)
					.flatMap((each) => (each.batch === null ? [] : [each.batch])),
			);
			const made = (await batchesIn(launch.commands.results)).filter(
				(each) => !launch.known.has(each) && !claimed.has(each),
			);
			// Concurrent runs each write a new batch: take the one that ran this launch's cases.
			const matching: string[] = [];
			for (const each of made) {
				if (
					await ranCases(launch.commands.results, each, launch.spec.scenarios)
				) {
					matching.push(each);
				}
			}
			// With no exact match, a batch may still be mid-write by a concurrent run
			// (its directory before its batch.json), so guess only when this run is alone.
			const alone = ![...this.launches.values()].some(
				(each) =>
					each !== launch &&
					each.status === "running" &&
					each.commands.root === launch.commands.root,
			);
			const candidates = matching.length > 0 ? matching : alone ? made : [];
			launch.batch = candidates.sort().at(-1) ?? null;
			if (launch.batch !== null) {
				await this.save(launch);
				if (launch.spec.conversation != null) {
					await this.budgets.landed(
						launch.spec.conversation,
						launch.id,
						launch.batch,
					);
				}
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
	/** The skill the case belongs to, when the project's `list` says. */
	skill?: string;
	prompt?: string;
	checks?: { id: string; about: string }[];
	judge?: string | null;
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

/** Whether the batch's cells run exactly the cases `scenarios` names; false when it cannot be read yet. */
async function ranCases(
	results: string,
	batch: string,
	scenarios: string[],
): Promise<boolean> {
	try {
		const { cells } = JSON.parse(
			await readFile(join(results, batch, "batch.json"), "utf8"),
		) as { cells?: { case?: unknown }[] };
		const ran = new Set((cells ?? []).map((each) => each.case));
		return (
			ran.size === new Set(scenarios).size &&
			scenarios.every((each) => ran.has(each))
		);
	} catch {
		return false;
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

export interface SavedLaunch {
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
