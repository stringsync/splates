import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Priority } from "@evals/evals/scenario";
import type { AsyncResource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import type { Child, Ps } from "core/system";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Document, Storage } from "../storage";
import type { EvalBudgetSeed, EvalBudgetView } from "./auto";
import type { PassRule } from "./pass-rule";
import { EvalRounds } from "./rounds";
import { ScenarioCache } from "./scenario-cache";
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
	/** The rounds each conversation started. */
	readonly rounds: EvalRounds;
	private writing: Promise<void> = Promise.resolve();
	private disposing = false;
	private readonly listed: ScenarioCache;

	constructor(
		private readonly ps: Ps,
		private readonly storage: Storage,
	) {
		this.listed = new ScenarioCache(ps);
		this.record = storage.document("eval-launches.json");
		// Named for the budget it once kept too, so earlier rounds still link up.
		this.rounds = new EvalRounds(storage.document("eval-budgets.json"));
	}

	/** Every case the project's `list` prints. */
	async scenarios(
		commands: EvalCommands,
		cwd: string | null = null,
	): Promise<EvalScenario[]> {
		if (commands.list === null) {
			return [];
		}
		const [list, dir] = [commands.list, cwd ?? commands.root];
		return this.listed.of(dir, list, async () => {
			const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
				["sh", "-c", list],
				{ cwd: dir },
			);
			if (exitCode !== 0) {
				const said = tailOf(`${stdout}${stderr}`);
				fail("hook_failed", said || `evals.list exited ${exitCode}`, {});
			}
			// A file is listed absolute or from where `list` ran; the page names it
			// from the project's root, through the links (macOS's /tmp) either may resolve.
			const real = await realpath(dir).catch(() => dir);
			return parseScenarioList(stdout).map((each) => {
				if (each.file === undefined) {
					return each;
				}
				const at = resolve(dir, each.file);
				const from = at.startsWith(`${real}/`) ? real : dir;
				return { ...each, file: relative(from, at), fileAt: at };
			});
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
		const known = new Set(await batchesIn(commands.results));
		const reserved: SavedLaunch = {
			launch: {
				id: crypto.randomUUID(),
				key: spec.key,
				status: "running",
				batch: null,
				output: "",
				...(spec.auto === true ? { auto: true as const } : {}),
			},
			commands,
			spec,
		};
		// Persist the request before a process can spend, including a crash during spawn.
		await this.record.update((all) => ({ ...all, [id]: reserved }));
		if (conversation !== null) {
			await this.rounds.begin(conversation, {
				launch: reserved.launch.id,
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

	/** The launch that writes `batch` in this project, so its report can follow and stop it; null for none. */
	async ofBatch(
		commands: EvalCommands,
		batch: string,
	): Promise<EvalLaunch | null> {
		for (const launch of this.launches.values()) {
			if (launch.commands.root === commands.root && launch.batch === batch) {
				return this.read(launch);
			}
		}
		const saved = Object.values((await this.record.read()) ?? {}).find(
			(each) =>
				each.commands.root === commands.root && each.launch.batch === batch,
		);
		return saved?.launch ?? null;
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
			for (const round of await this.rounds.roundsOf(conversation)) {
				if (round.batch !== null) {
					owners.set(round.batch, conversation);
				}
			}
		}
		return owners;
	}

	/**
	 * Conversation `id`'s eval budget: what its person approved on its budget
	 * cards, and what its rounds have cost since the first approval, from
	 * their batches, so rounds before any budget never count against it.
	 */
	async budget(id: string): Promise<EvalBudgetView> {
		const grants = await this.rounds.grantsOf(id);
		const answers: Record<string, number | null> = {};
		let usd = 0;
		let since: string | null = null;
		let seeded: EvalBudgetSeed | undefined;
		for (const grant of grants) {
			if (grant.automation !== undefined && grant.usd !== null) {
				seeded = {
					usd: grant.usd,
					automation: grant.automation.id,
					...(grant.automation.name === undefined
						? {}
						: { name: grant.automation.name }),
				};
			} else {
				answers[grant.card] = grant.usd;
			}
			if (grant.usd !== null) {
				usd += grant.usd;
				since ??= grant.at;
			}
		}
		const spent =
			since === null ? 0 : ((await this.costs(id, since)).get(id)?.usd ?? 0);
		return {
			usd: Math.round(usd * 100) / 100,
			spent,
			answers,
			...(seeded === undefined ? {} : { seeded }),
		};
	}

	/**
	 * What each conversation's rounds have cost, with when its latest began;
	 * only `only`'s when given, and only rounds begun at `since` or later.
	 */
	async costs(
		only: string | null = null,
		since: string | null = null,
	): Promise<Map<string, { usd: number; last: string }>> {
		const dirs = new Map<string, Set<string>>();
		for (const saved of Object.values((await this.record.read()) ?? {})) {
			const conversation = saved.spec.conversation;
			if (conversation != null && (only === null || conversation === only)) {
				const each = dirs.get(conversation) ?? new Set<string>();
				each.add(saved.commands.results);
				dirs.set(conversation, each);
			}
		}
		const costs = new Map<string, { usd: number; last: string }>();
		for (const [conversation, results] of dirs) {
			let usd = 0;
			let last = "";
			for (const round of await this.rounds.roundsOf(conversation)) {
				if (round.batch === null) {
					continue;
				}
				for (const dir of results) {
					const grid = await new EvalStore(dir).grid(round.batch);
					if (grid !== null) {
						if (since !== null && grid.startedAt < since) {
							break;
						}
						usd += grid.costUsd ?? 0;
						last = grid.startedAt > last ? grid.startedAt : last;
						break;
					}
				}
			}
			if (last !== "") {
				costs.set(conversation, { usd, last });
			}
		}
		return costs;
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
			// A refusal ran nothing, so it is no round.
			await this.rounds.drop(launch.spec.conversation, launch.id);
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
				rules: await this.rulesOf(launch.commands),
			});
		} else {
			this.running(launch);
		}
	}

	/** Each listed spec's own pass rule; empty when the list cannot be read. */
	private async rulesOf(
		commands: EvalCommands,
	): Promise<Map<string, PassRule>> {
		const listed = await this.scenarios(commands).catch(() => []);
		return new Map(
			listed.flatMap((each) =>
				each.pass === undefined ? [] : [[each.id, each.pass] as const],
			),
		);
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
					await this.rounds.landed(
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
	/** Started by the server within the conversation's eval budget, as every card's round is, rather than from the Evals page. */
	auto?: boolean;
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
	/** Started by the server within the conversation's eval budget, not from the Evals page. */
	auto?: true;
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
	/** The spec's `it(...)` sentence, when the case is written as a spec. */
	sentence?: string;
	/** The `describe(...)` groups around the spec, outermost first: the suite, then its groups. */
	groups?: string[];
	/** How many of its last graded runs on an agent must pass, when the spec sets its own; 2 of 3 otherwise. */
	pass?: PassRule;
	/** Which scenarios run first when a budget cannot run them all; unset is `normal`. */
	priority?: Priority;
	/** The file that holds the spec, from the project's root; `list` prints it absolute or from where it ran. The Evals page groups specs by it. */
	file?: string;
	/** `file` as an absolute path, for an editor to open. */
	fileAt?: string;
	/** The skill the case belongs to, when the project's `list` says. */
	skill?: string;
	prompt?: string;
	checks?: { id: string; about: string }[];
	judge?: string | null;
	/** The judge that grades the scenario (for example `claude:sonnet`), when the list names one. */
	judgeWith?: string;
	/** The repo it starts from, in a line (backticks as code), when the list says. */
	environment?: string;
	/** A sketched good reply to the prompt, in order, when the list gives one. */
	example?: EvalExampleTurn[];
}

/** One step of a sketched reply: a stretch of words, or a tool call with what it does in plain words. */
export type EvalExampleTurn =
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string; input: string; does: string | null };

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
		...(launch.spec.auto === true ? { auto: true as const } : {}),
	};
}

/** A run that finished with its batch written, for the conversation whose card started it. */
export interface EvalFinished {
	launch: EvalLaunch;
	/** The directory the batch is in. */
	results: string;
	conversation: string;
	/** The pass rules of the specs that set their own, by spec id. */
	rules: ReadonlyMap<string, PassRule>;
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
