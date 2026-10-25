import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Child, Ps } from "webappwiz/system";
import type { AgentPick } from "../models";

/** What the person's Run button asks for: the evals of one card, on the agents it ended with. */
export interface EvalLaunchSpec {
	/** Names the card, so a reload finds its run again. */
	key: string;
	skill: string;
	probes: string[];
	agents: AgentPick[];
	/** The revision the skill's change is judged against; the runner's own default when null. */
	baseline: string | null;
	/** The conversation whose card it is, told once it is done; null for none. */
	conversation?: string | null;
}

/** How a launch stands. `refused` is the runner declining before it wrote a batch. */
export type EvalLaunchStatus = "running" | "done" | "refused" | "stopped";

/** A launch as the card reads it. */
export interface EvalLaunch {
	id: string;
	key: string;
	status: EvalLaunchStatus;
	/** The `batch-*` directory it writes, once the runner has made it. */
	batch: string | null;
	/** The runner's last words, as the CLI says them: a refusal's reason. */
	output: string;
}

/** What the runner says in a plan: how much it would reserve, in its words. */
export interface EvalPlan {
	/** Probe-by-agent runs the plan comes to. */
	cells: number;
	tokens: number | null;
	usd: number | null;
	/** The runner's output, for a refusal or anything the numbers leave out. */
	output: string;
}

/** A probe the harness registers, as `splates dev eval list` names it. */
export interface EvalProbe {
	id: string;
	aspect: string;
	requirement: string;
	kind: string;
}

const TAIL = 20;

/** `claude:MODEL@EFFORT` for a pick, as `--target` takes it. */
export function targetOf(pick: AgentPick): string {
	return `${pick.agent}${pick.model === undefined ? "" : `:${pick.model}`}${
		pick.effort === undefined ? "" : `@${pick.effort}`
	}`;
}

interface EvalLaunchesOptions {
	ps: Ps;
	/** The checkout's root, whose `bin/splates` runs the harness. */
	checkout: string;
	/** Where batches are written. */
	directory: string;
}

/**
 * Starts, follows and stops the paid runs the Evals card asks for, and says
 * `finished` when one started from a conversation's card is done, for that
 * conversation to be told. A restart forgets which launch was whose, though
 * the batch it wrote stays on the Evals page.
 */
export class EvalLaunches implements Eventful<EvalLaunchesEvents>, Resource {
	private readonly dispatcher = new Dispatcher<EvalLaunchesEvents>();
	readonly events = this.dispatcher.events;
	private readonly launches = new Map<string, Launched>();

	// Each run is the existing runner as a child (`splates dev eval fast ...
	// --yes`), so its change gate, shared budgets and admission stay the
	// harness's; launches are held in memory.
	constructor(private readonly opts: EvalLaunchesOptions) {}

	/** Every probe the harness registers. */
	async probes(): Promise<EvalProbe[]> {
		const { stdout } = await this.opts.ps.spawnCapture(
			[join(this.opts.checkout, "bin/splates"), "dev", "eval", "list"],
			{ cwd: this.opts.checkout },
		);
		return stdout
			.split("\n")
			.map((line) => line.split("\t"))
			.filter((parts) => parts.length === 4)
			.map(([id, aspect, requirement, kind]) => ({
				id: id as string,
				aspect: aspect as string,
				requirement: requirement as string,
				kind: kind as string,
			}));
	}

	/** Runs the free `plan` for `spec` and reads its reservation off the output. */
	async plan(spec: Omit<EvalLaunchSpec, "key">): Promise<EvalPlan> {
		const { exitCode, stdout, stderr } = await this.opts.ps.spawnCapture(
			this.argv("plan", spec),
			{ cwd: this.opts.checkout },
		);
		const output = `${stdout}${stderr}`.trim();
		const limits =
			/aggregate admission limits (\d+) tokens \/ USD ([\d.]+)/.exec(output);
		return {
			cells: spec.probes.length * Math.max(1, spec.agents.length),
			tokens: exitCode === 0 && limits ? Number(limits[1]) : null,
			usd: exitCode === 0 && limits ? Number(limits[2]) : null,
			output: tailOf(output),
		};
	}

	/** Starts `spec`, unless its card already has a run going. */
	async start(spec: EvalLaunchSpec): Promise<EvalLaunch> {
		const held = this.launches.get(spec.key);
		if (held !== undefined && held.status === "running") {
			return this.read(held);
		}
		const known = new Set(await this.batches());
		const child = this.opts.ps.start(this.argv("fast", spec, ["--yes"]), {
			cwd: this.opts.checkout,
		});
		const launch: Launched = {
			id: crypto.randomUUID(),
			key: spec.key,
			status: "running",
			batch: null,
			output: "",
			child,
			known,
			stopping: false,
			conversation: spec.conversation ?? null,
		};
		this.launches.set(spec.key, launch);
		void this.watch(launch);
		return this.read(launch);
	}

	/** The run of the card `key` names, or null when it has none here. */
	async get(key: string): Promise<EvalLaunch | null> {
		const launch = this.launches.get(key);
		return launch === undefined ? null : this.read(launch);
	}

	/** Stops the run of the card `key` names; its landed cells stay on the Evals page. */
	async stop(key: string): Promise<EvalLaunch | null> {
		const launch = this.launches.get(key);
		if (launch === undefined) {
			return null;
		}
		if (launch.status === "running") {
			launch.stopping = true;
			launch.child.kill();
		}
		return this.read(launch);
	}

	dispose(): void {
		for (const launch of this.launches.values()) {
			if (launch.status === "running") {
				launch.stopping = true;
				launch.child.kill();
			}
		}
	}

	private argv(
		command: "plan" | "fast",
		spec: Omit<EvalLaunchSpec, "key">,
		rest: string[] = [],
	): string[] {
		return [
			join(this.opts.checkout, "bin/splates"),
			"dev",
			"eval",
			command,
			...spec.probes.flatMap((probe) => ["--probe", probe]),
			...spec.agents.flatMap((pick) => ["--target", targetOf(pick)]),
			...(spec.baseline === null ? [] : ["--baseline", spec.baseline]),
			"--directory",
			this.opts.directory,
			...rest,
		];
	}

	private async batches(): Promise<string[]> {
		return (await readdir(this.opts.directory).catch(() => [])).filter((each) =>
			each.startsWith("batch-"),
		);
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
		launch.status = launch.stopping
			? "stopped"
			: code === 0
				? "done"
				: launch.batch === null
					? "refused"
					: "done";
		if (
			launch.status === "done" &&
			launch.batch !== null &&
			launch.conversation !== null
		) {
			this.dispatcher.dispatch("finished", {
				launch: viewOf(launch),
				conversation: launch.conversation,
			});
		}
	}

	/** The launch, its batch found if the runner has made one since it started. */
	private async read(launch: Launched): Promise<EvalLaunch> {
		if (launch.batch === null) {
			const made = (await this.batches()).filter(
				(each) => !launch.known.has(each),
			);
			launch.batch = made.sort().at(-1) ?? null;
		}
		return viewOf(launch);
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
	conversation: string;
}

export type EvalLaunchesEvents = { finished: EvalFinished };

interface Launched extends EvalLaunch {
	child: Child;
	known: Set<string>;
	stopping: boolean;
	conversation: string | null;
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
