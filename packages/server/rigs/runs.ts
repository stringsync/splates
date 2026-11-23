import type { Ps } from "core/system";
import type { AgentProcess, Launcher, ProcessHandle } from "../agents/process";
import type { RigProxyTargets } from "../ports";
import { quoted } from "../ship/shell";
import type { Document } from "../storage";
import type { RigListing } from "./commands";
import { collectRigProxyTargets, parseReportedUrl, runPorts } from "./exposure";
import { checkRigHealth, freePort } from "./health";
import { RunRefused } from "./refused";
import type {
	RunLog,
	RunRequest,
	RunSlot,
	RunState,
	RunTree,
	RunView,
} from "./run";
import { RigSlots } from "./slots";
import { type OptionValues, optionValues, runEnv, startWords } from "./start";
import type { Rig } from "./wire";

/** How often a run is checked while starting, and once it has been up. */
export const CHECK_EVERY = { starting: 1000, running: 10_000 };

/** What {@link RigRuns} starts, finds and checks runs with. */
export interface RigRunsDeps {
	/** The rigs the project's commands declare. */
	listing(): Promise<RigListing>;
	/** The trees a run may start on: main and each task's worktree. */
	trees(): Promise<RunTree[]>;
	/**
	 * Starts a run's process, and takes one back after a restart: on the
	 * worker, whose stop ends everything under it and which keeps a run
	 * going while the server restarts.
	 */
	launcher: Launcher;
	/** Where the runs are kept for a restart to take back. */
	kept: Document<KeptRun[]>;
	/** Animal slots assigned to tunnel-exposed rigs; defaults to an isolated pool. */
	slots?: RigSlots;
	/** A port free now, one per port a rig declares; {@link freePort} by default. */
	freePort?: () => Promise<number>;
	/** Runs a command health check. */
	ps: Pick<Ps, "spawnCapture">;
	/** `<animal>.<base>` is a tunnel-exposed run port's remote link; null for none. */
	base: string | null;
	/** The local splates server URL, available once the server listens. */
	readonly serverUrl?: string | null;
	now?: () => number;
	/** How often to check, in ms; {@link CHECK_EVERY} by default. */
	every?: { starting: number; running: number };
}

/**
 * The runs of a project's rigs: each started with a free port per port it
 * declares, checked for health until it ends, its log kept, and stopped on
 * request or once its task's worktree is gone.
 */
export class RigRuns {
	readonly #runs = new Map<string, Held>();
	readonly #deps: RigRunsDeps;
	readonly #slots: RigSlots;
	/** Set once the runs are let go of for a restart, which a later dispose leaves be. */
	#detached = false;

	constructor(deps: RigRunsDeps) {
		this.#deps = deps;
		this.#slots = deps.slots ?? RigSlots.memory();
	}

	/** Every run, newest first. */
	list(): RunView[] {
		return [...this.#runs.values()]
			.sort((one, other) => other.startedAt - one.startedAt)
			.map((held) => this.#view(held));
	}

	/** Starts `request`'s rig on its tree, refusing a second run of it there. */
	async start(request: RunRequest): Promise<RunView> {
		const { groups } = await this.#deps.listing();
		const group = groups.find((each) => each.name === request.group);
		const rig = group?.rigs.find((each) => each.name === request.rig);
		if (group === undefined || rig === undefined) {
			throw new RunRefused(
				`no rig "${request.rig}" in "${request.group}"`,
				404,
			);
		}
		const tree = (await this.#deps.trees()).find(
			(each) => each.name === request.tree,
		);
		if (tree === undefined) {
			throw new RunRefused(`no tree "${request.tree}" to run on`, 404);
		}
		const id = `${group.name}/${rig.name}@${tree.name}`;
		const earlier = this.#runs.get(id);
		if (earlier !== undefined && earlier.state !== "exited") {
			throw new RunRefused(`${rig.label} already runs on ${tree.name}`, 409);
		}
		let values: OptionValues;
		try {
			values = optionValues(rig, request.values ?? {});
		} catch (error) {
			throw new RunRefused(
				error instanceof Error ? error.message : String(error),
				400,
			);
		}
		this.#forget(id);
		let slot: RunSlot | null = null;
		if (rig.exposure === "tunnel" && this.#deps.base !== null) {
			try {
				slot = await this.#slots.claim(
					slotKey(group.name, rig.name, tree.path),
					tree.path,
				);
			} catch (error) {
				throw new RunRefused(
					error instanceof Error ? error.message : String(error),
					409,
				);
			}
		}
		const ports: Record<string, number> = {};
		for (const name of rig.ports) {
			const free = this.#deps.freePort ?? freePort;
			let port = await free();
			while (Object.values(ports).includes(port)) {
				port = await free();
			}
			ports[name] = port;
		}
		const env = runEnv(rig, ports, id, this.#deps.serverUrl);
		const line = [group.command, ...startWords(rig, values).map(quoted)].join(
			" ",
		);
		// Its stderr joins its stdout, as one log.
		const process = this.#deps.launcher.launch(
			["sh", "-c", `exec ${line} 2>&1`],
			tree.path,
			env,
		);
		const held: Held = {
			id,
			group: group.name,
			command: group.command,
			rig,
			tree,
			values,
			preset: request.preset ?? null,
			ports,
			slot,
			reportedUrls: {},
			env,
			process,
			state: "starting",
			health: null,
			exitCode: null,
			startedAt: this.#now(),
			endedAt: null,
			stopping: false,
			log: [],
			logged: 0,
			acked: 0,
			timer: null,
		};
		this.#follow(held);
		void this.#keep();
		return this.#view(held);
	}

	/**
	 * Takes back the runs a server before this one kept going through its
	 * restart, as it starts: each whose rig is still declared carries on, its
	 * log starting over; one the worker no longer holds is dropped.
	 */
	async resume(): Promise<void> {
		const kept = (await this.#deps.kept.read().catch(() => null)) ?? [];
		if (kept.length === 0) {
			return;
		}
		const { groups } = await this.#deps.listing().catch(() => ({
			groups: [],
		}));
		for (const each of kept) {
			let process: AgentProcess;
			try {
				process = this.#deps.launcher.resume(each.handle, each.held);
			} catch {
				continue;
			}
			const group = groups.find((one) => one.name === each.group);
			const rig = group?.rigs.find((one) => one.name === each.rig);
			if (group === undefined || rig === undefined) {
				// Its rig is no longer declared, so nothing could show or check it.
				process.kill();
				continue;
			}
			let slot: RunSlot | null = null;
			if (rig.exposure === "tunnel" && this.#deps.base !== null) {
				slot =
					each.slot ??
					(await this.#slots
						.claim(
							slotKey(each.group, rig.name, each.tree.path),
							each.tree.path,
						)
						.catch(() => null));
			}
			const held: Held = {
				id: each.id,
				group: each.group,
				command: group.command,
				rig,
				tree: each.tree,
				values: each.values,
				preset: each.preset,
				ports: each.ports,
				slot,
				reportedUrls: { ...(each.reportedUrls ?? {}) },
				env: runEnv(rig, each.ports, each.id, this.#deps.serverUrl),
				process,
				state: "starting",
				health: null,
				exitCode: null,
				startedAt: each.startedAt,
				endedAt: null,
				stopping: false,
				log: [
					{ n: 1, text: "(splates restarted: earlier lines are not kept)" },
				],
				logged: 1,
				acked: each.held,
				timer: null,
			};
			this.#follow(held);
		}
		await this.#keep();
	}

	/**
	 * Lets go of every run without ending it, for a server started again to
	 * take back, as a restart that hands over does. Says whether one was kept.
	 */
	async detach(): Promise<boolean> {
		this.#detached = true;
		for (const held of this.#runs.values()) {
			this.#clear(held);
		}
		const kept = await this.#keep();
		this.#runs.clear();
		return kept > 0;
	}

	/** Stops run `id`, which then leaves the list; an exited one only leaves it. */
	stop(id: string): boolean {
		const held = this.#runs.get(id);
		if (held === undefined) {
			return false;
		}
		if (held.state === "exited") {
			this.#forget(id);
			return true;
		}
		held.stopping = true;
		held.process.kill();
		return true;
	}

	/** Lines of run `id`'s log after line `after`; null for no such run. */
	log(id: string, after = 0): RunLog | null {
		const held = this.#runs.get(id);
		if (held === undefined) {
			return null;
		}
		return {
			lines: held.log.filter((line) => line.n > after),
			last: held.logged,
		};
	}

	/** The pid of each live tunnel-exposed run, by its tree, so its ports are found as the tree's. */
	owners(): { task: string; pid: number }[] {
		return [...this.#runs.values()].flatMap((held) =>
			held.state !== "exited" &&
			!held.stopping &&
			held.rig.exposure === "tunnel" &&
			held.process.pid !== null
				? [{ task: held.tree.name, pid: held.process.pid }]
				: [],
		);
	}

	/** Live animal-slot routes for tunnel-exposed rigs, plus ports excluded from splates's proxy. */
	proxyTargets(): RigProxyTargets {
		return collectRigProxyTargets(
			[...this.#runs.values()].map((held) => ({
				id: held.id,
				rig: held.rig,
				ports: held.ports,
				slot: held.slot,
				live: !this.#ended(held),
			})),
		);
	}

	/** Stops every run, as the server does when it stops without handing over. */
	dispose(): void {
		if (this.#detached) {
			return;
		}
		for (const held of this.#runs.values()) {
			this.#clear(held);
			if (held.state !== "exited") {
				held.process.kill();
			}
		}
		this.#runs.clear();
		void this.#deps.kept.write([]).catch(() => {});
	}

	/** Holds `held` as a run, reading its log and checking it until it ends. */
	#follow(held: Held): void {
		this.#runs.set(held.id, held);
		void this.#read(held);
		void held.process.exited.then((code) => this.#exited(held, code));
		this.#schedule(held, 0);
	}

	/** Writes down each live run a worker holds; answers how many. */
	async #keep(): Promise<number> {
		const kept: KeptRun[] = [];
		for (const held of this.#runs.values()) {
			const { handle } = held.process;
			if (held.state === "exited" || held.stopping || handle === null) {
				continue;
			}
			kept.push({
				id: held.id,
				group: held.group,
				rig: held.rig.name,
				tree: held.tree,
				values: held.values,
				preset: held.preset,
				ports: held.ports,
				slot: held.slot,
				reportedUrls:
					Object.keys(held.reportedUrls).length > 0
						? held.reportedUrls
						: undefined,
				startedAt: held.startedAt,
				handle,
				held: held.acked,
			});
		}
		await this.#deps.kept.write(kept).catch(() => {});
		return kept.length;
	}

	#view(held: Held): RunView {
		return {
			id: held.id,
			group: held.group,
			rig: held.rig.name,
			label: held.rig.label,
			tree: held.tree.name,
			exposure: held.rig.exposure,
			slot: held.slot,
			values: held.values,
			preset: held.preset,
			state: held.state,
			health: held.health,
			exitCode: held.exitCode,
			startedAt: held.startedAt,
			endedAt: held.endedAt,
			ports: runPorts(
				held.rig,
				held.ports,
				held.slot,
				held.reportedUrls,
				this.#deps.base,
			),
			lastLine: held.log.at(-1)?.text ?? null,
		};
	}

	async #read(held: Held): Promise<void> {
		const decoder = new TextDecoder();
		let partial = "";
		const add = (text: string) => {
			held.logged += 1;
			held.log.push({ n: held.logged, text });
			if (held.log.length > LOG_LINES) {
				held.log.shift();
			}
			if (held.rig.exposure === "self") {
				const reported = parseReportedUrl(text, held.rig.ports);
				if (
					reported !== null &&
					held.reportedUrls[reported.port] !== reported.url
				) {
					held.reportedUrls[reported.port] = reported.url;
					void this.#keep();
				}
			}
		};
		try {
			for await (const frame of held.process.output) {
				const split = (
					partial + decoder.decode(frame.bytes, { stream: true })
				).split(/\r?\n/);
				partial = split.pop() ?? "";
				split.forEach(add);
				// Read, so the worker need not keep it, nor stall the run on it.
				held.acked = frame.seq;
				held.process.ack(frame.seq);
			}
		} catch {
			// Its output ended with it: what it said so far is kept.
		}
		const last = partial + decoder.decode();
		if (last !== "") {
			add(last);
		}
	}

	#exited(held: Held, code: number): void {
		this.#clear(held);
		if (this.#runs.get(held.id) !== held) {
			return;
		}
		if (held.stopping) {
			this.#runs.delete(held.id);
		} else {
			held.state = "exited";
			held.exitCode = code;
			held.endedAt = this.#now();
			const said = held.process.stderr().trim();
			if (said !== "") {
				held.log.push({ n: ++held.logged, text: said });
			}
		}
		void this.#keep();
	}

	#schedule(held: Held, ms: number): void {
		this.#clear(held);
		held.timer = setTimeout(() => void this.#tick(held), ms);
	}

	#clear(held: Held): void {
		if (held.timer !== null) {
			clearTimeout(held.timer);
			held.timer = null;
		}
	}

	/** Checks `held`'s tree is still there and its health, then schedules the next look. */
	async #tick(held: Held): Promise<void> {
		held.timer = null;
		if (held.state === "exited" || held.stopping) {
			return;
		}
		const trees = await this.#deps.trees().catch(() => null);
		if (trees !== null && !trees.some((each) => each.name === held.tree.name)) {
			if (held.slot !== null) {
				void this.#slots
					.release(slotKey(held.group, held.rig.name, held.tree.path))
					.catch(() => {});
			}
			this.stop(held.id);
			return;
		}
		const passed = await this.#check(held);
		// It may have exited or been stopped while the check was out.
		if (this.#ended(held)) {
			return;
		}
		if (passed) {
			held.state = "healthy";
		} else if (
			held.state !== "starting" ||
			this.#now() - held.startedAt > START_GRACE_MS
		) {
			held.state = "unhealthy";
		}
		const every = this.#deps.every ?? CHECK_EVERY;
		this.#schedule(
			held,
			held.state === "starting" ? every.starting : every.running,
		);
	}

	async #check(held: Held): Promise<boolean> {
		const result = await checkRigHealth(
			this.#deps.ps,
			held.rig,
			held.ports,
			held.tree.path,
			held.env,
		);
		if (result.summary !== null) {
			held.health = result.summary;
		}
		return result.passed;
	}

	#ended(held: Held): boolean {
		return held.state === "exited" || held.stopping;
	}

	#forget(id: string): void {
		const held = this.#runs.get(id);
		if (held !== undefined) {
			this.#clear(held);
			this.#runs.delete(id);
		}
	}

	#now(): number {
		return (this.#deps.now ?? Date.now)();
	}
}

export { freePort };

/** A run as kept for a server started again to take back. */
export interface KeptRun {
	id: string;
	group: string;
	rig: string;
	tree: RunTree;
	values: OptionValues;
	preset: string | null;
	ports: Record<string, number>;
	/** Animal slot assigned to a tunnel-exposed run, or null when unexposed. */
	slot?: RunSlot | null;
	/** Public URLs reported by a `self`-exposed run, by port name. */
	reportedUrls?: Record<string, string>;
	startedAt: number;
	handle: ProcessHandle;
	/** The last frame of its output read, for the worker to carry on after. */
	held: number;
}

/** How many lines of each run's log are kept. */
const LOG_LINES = 500;

/** How long a run may start before it counts as unhealthy. */
const START_GRACE_MS = 120_000;

/** One run as the runner holds it. */
interface Held {
	id: string;
	group: string;
	command: string;
	rig: Rig;
	tree: RunTree;
	values: OptionValues;
	preset: string | null;
	ports: Record<string, number>;
	slot: RunSlot | null;
	reportedUrls: Record<string, string>;
	env: Record<string, string>;
	process: AgentProcess;
	state: RunState;
	health: string | null;
	exitCode: number | null;
	startedAt: number;
	endedAt: number | null;
	stopping: boolean;
	log: { n: number; text: string }[];
	logged: number;
	/** The last frame of its output read and acked. */
	acked: number;
	timer: ReturnType<typeof setTimeout> | null;
}

/** Persistent claim key tying a rig and tree path to one animal slot. */
function slotKey(group: string, rig: string, treePath: string): string {
	return `${group}/${rig}@${treePath}`;
}
