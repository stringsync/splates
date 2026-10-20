import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Fs, Ps } from "webappwiz/system";
import {
	type Clock,
	Duration,
	SystemClock,
	SystemTimer,
	type Timer,
} from "webappwiz/time";
import { SUPERVISOR } from "../workers";

/** What a server exits with to be started again as it was. */
export const RESTART = 75;

/** What a server exits with to be started again on the newest splates. */
export const UPDATE = 76;

/**
 * Set in the server's environment, so the `splates server` it runs serves rather
 * than supervising another.
 */
export const SERVING = "SPLATES_DEV_SERVING";

/**
 * Set in the server's environment when its page failed to build: the page
 * then says it may be out of date.
 */
export const UNBUILT = "SPLATES_DEV_UNBUILT";

/** What starts `splates server` on the newest splates, with `args` after `server`. */
const NEWEST = ["bunx", "@stringsync/splates@latest"];

/**
 * Runs `splates server` as a child of this process, sharing its terminal, and
 * starts another each time the child exits to restart: as this one was
 * started, or on the newest splates when it asks to update. Ctrl-C reaches the
 * child too, and its exit ends this. A SIGTERM or SIGHUP to this one stops the
 * child with a SIGTERM and ends this, since the child would otherwise outlive
 * it, listening on its port. A `worker` runs beside it as a second child,
 * told this process's pid so it ends once this is gone. Both stop, ending
 * this with 0, once the `checkout` it runs from is deleted. A child that
 * crashes, ending any other way than with 0, Ctrl-C or a stop, is started
 * again after a pause that doubles with each crash that came quickly, until
 * so many come in a row that it would only crash again. With `awake`, the
 * platform's own command keeps the machine from sleeping while this runs,
 * as `awakeCommand` names it.
 * Answers with the exit code to end on.
 */
export async function supervise(
	ps: Ps,
	{
		build = null,
		env = {},
		cwd,
		worker = null,
		checkout = null,
		awake = false,
		log = null,
		timer = new SystemTimer(),
		clock = new SystemClock(),
	}: SuperviseOptions = {},
): Promise<number> {
	let splates = ps.self;
	let argv = [...splates, ...ps.args];
	// Built until it updates: npm's splates ships its page.
	let building = build;
	// Ctrl-C is the child's to end on, and its exit then ends this, never
	// read as a crash.
	let interrupted = false;
	const quiet = ps.on("SIGINT", () => {
		interrupted = true;
	});
	const stopping = new AbortController();
	let stopped = 0;
	const stopOn = (signal: string, code: number) =>
		ps.on(signal, () => {
			stopped = code;
			stopping.abort();
		});
	const terminated = stopOn("SIGTERM", 128 + 15);
	const hungUp = stopOn("SIGHUP", 128 + 1);
	const watching = checkout === null ? null : watch(checkout, stopping, timer);
	// Its own, since the server restarting leaves it running.
	const working = new AbortController();
	if (worker !== null) {
		void keep(ps, () => [...splates, ...worker], {
			env: { ...env, [SUPERVISOR]: String(ps.pid) },
			cwd,
			signal: working.signal,
			timer,
		});
	}
	const waking = awake ? keepAwake(ps, log) : null;
	// The crashes in a row that came before the server served a while.
	let quick = 0;
	try {
		for (;;) {
			// A failed build has said why on the terminal, and the page it left
			// behind is still one to serve, saying it failed.
			const built =
				building === null ||
				(await ps.spawn(building.argv, { cwd: building.cwd })).exitCode === 0;
			if (stopping.signal.aborted) {
				return stopped;
			}
			let exitCode: number;
			const began = clock.now();
			try {
				({ exitCode } = await ps.spawn(argv, {
					env: {
						...env,
						[SERVING]: "1",
						...(built ? {} : { [UNBUILT]: "1" }),
					},
					cwd,
					signal: stopping.signal,
				}));
			} catch (error) {
				// An abort rejects the spawn once the child is gone.
				if (stopping.signal.aborted) {
					return stopped;
				}
				throw error;
			}
			if (exitCode === UPDATE) {
				splates = NEWEST;
				argv = [...splates, ...ps.args];
				building = null;
			} else if (exitCode !== RESTART) {
				if (interrupted || STOPS.includes(exitCode)) {
					return exitCode;
				}
				// One that served a while crashed afresh, not again.
				const served = clock.now().subtract(began);
				quick = served.isLessThan(SERVED) ? quick + 1 : 1;
				if (quick >= CRASHES) {
					log?.error(
						`splates server exited (${exitCode}) ${quick} times in a row before serving ${SERVED.human()}: giving up`,
					);
					return exitCode;
				}
				const pause = FIRST_PAUSE.multiply(2 ** (quick - 1));
				log?.error(
					`splates server exited (${exitCode}), starting it again in ${pause.human()}`,
				);
				await sleep(pause, timer, stopping.signal);
				if (stopping.signal.aborted) {
					return stopped;
				}
				if (interrupted) {
					return exitCode;
				}
			}
		}
	} finally {
		waking?.dispose();
		working.abort();
		watching?.dispose();
		quiet.dispose();
		terminated.dispose();
		hungUp.dispose();
	}
}

/** What `supervise` starts the server with, beyond the process it runs in. */
export interface SuperviseOptions {
	/**
	 * Builds the page, run before each start of the same splates, as from a
	 * checkout, whose page `bun install` built last and the commits since may
	 * have changed, packages they added included; null for one installed from
	 * npm, whose page shipped built.
	 */
	build?: { argv: string[]; cwd: string } | null;
	/** Added to the server's environment, as a slot's home is. */
	env?: Record<string, string>;
	/** Where the server runs, the working directory by default. */
	cwd?: string;
	/**
	 * The arguments of a worker to run beside the server, as `["worker",
	 * "run"]`: started again whenever it ends, on the newest splates once the
	 * server updates, and stopped with this. Null for none.
	 */
	worker?: string[] | null;
	/**
	 * The checkout this runs from, looked at while it serves: once it is gone,
	 * as a task's worktree is when the task merges, the server and its worker
	 * stop, since nothing of theirs is left to start again. Null for splates
	 * installed from npm.
	 */
	checkout?: { path: string; fs: Pick<Fs, "exists"> } | null;
	/** Whether to keep the machine awake while this runs, as `awakeCommand` does. */
	awake?: boolean;
	/** Where a crashed server is told of; null to tell no one. */
	log?: Logger | null;
	timer?: Timer;
	clock?: Clock;
}

/**
 * What a server that meant to end exits with: 0 when the page shuts it down,
 * and Ctrl-C's or a SIGTERM's code when one reached it alone.
 */
const STOPS = [0, 128 + 2, 128 + 15];

/** How long the first crash in a row is waited on before the server starts again. */
const FIRST_PAUSE = Duration.secs(2);

/** How long a server must serve for its crash to start a new row. */
const SERVED = Duration.mins(1);

/**
 * How many crashes in a row, each before the server served `SERVED`, end
 * this: one that cannot start would otherwise crash forever.
 */
const CRASHES = 5;

/** How often a server run from a checkout looks for the checkout. */
const CHECKOUT_POLL = Duration.secs(5);

/** How long a worker that ended waits before it is started again. */
const WORKER_PAUSE = Duration.secs(1);

/** Aborts `stopping` once `checkout` is gone, looking every `CHECKOUT_POLL`. */
function watch(
	{ path, fs }: NonNullable<SuperviseOptions["checkout"]>,
	stopping: AbortController,
	timer: Timer,
) {
	return timer.setInterval(() => {
		void fs.exists(path).then((there) => {
			if (!there) {
				stopping.abort();
			}
		});
	}, CHECKOUT_POLL);
}

/**
 * Runs `argv()` until `signal` aborts, starting it again a pause after each
 * time it ends, so one that dies at once does not spin.
 */
async function keep(
	ps: Ps,
	argv: () => string[],
	{ timer, ...opts }: KeepOptions,
): Promise<void> {
	while (!opts.signal.aborted) {
		// An abort rejects the spawn once the worker is gone.
		await ps.spawn(argv(), opts).catch(() => {});
		await sleep(WORKER_PAUSE, timer, opts.signal);
	}
}

/**
 * What keeps this machine from sleeping until the process `pid` ends, on
 * `platform`: `caffeinate` on macOS, and on Linux a systemd inhibitor lock
 * held by a `tail` that waits on the pid. Null where there is none.
 */
export function awakeCommand(
	platform: NodeJS.Platform,
	pid: number,
): string[] | null {
	if (platform === "darwin") {
		return ["caffeinate", "-ims", "-w", String(pid)];
	}
	if (platform === "linux") {
		return [
			"systemd-inhibit",
			"--what=sleep:idle",
			"--who=splates",
			"--why=splates server is serving",
			"tail",
			`--pid=${pid}`,
			"-f",
			"/dev/null",
		];
	}
	return null;
}

/**
 * Runs `awakeCommand` until disposed. One that cannot run, as without
 * systemd or where it refuses the lock, is told of and the server serves on.
 */
function keepAwake(ps: Ps, log: Logger | null): Resource {
	const argv = awakeCommand(ps.platform, ps.pid);
	if (argv === null) {
		log?.error(`nothing keeps ${ps.platform} awake: serving without it`);
		return { dispose() {} };
	}
	const [name] = argv;
	let child: Child;
	try {
		child = ps.start(argv);
	} catch (error) {
		log?.error(`${name} could not start, so the machine may sleep: ${error}`);
		return { dispose() {} };
	}
	let disposed = false;
	void child.exited.then((code) => {
		if (!disposed) {
			log?.error(`${name} exited (${code}), so the machine may sleep`);
		}
	});
	return {
		dispose() {
			disposed = true;
			child.kill();
		},
	};
}

/** Waits `pause`, or until `signal` aborts. */
function sleep(
	pause: Duration,
	timer: Timer,
	signal: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve) => {
		const waiting = timer.setTimeout(resolve, pause);
		signal.addEventListener(
			"abort",
			() => {
				waiting.dispose();
				resolve();
			},
			{ once: true },
		);
	});
}

/** What `keep` runs its child with, and stops it on. */
interface KeepOptions {
	env: Record<string, string>;
	cwd?: string;
	signal: AbortSignal;
	timer: Timer;
}
