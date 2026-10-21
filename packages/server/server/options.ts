import type { Pusher, VapidKeys } from "webappwiz/push";
import type { HeavyCap, PortProvider } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import type { Config } from "../config";
import type { Conversations } from "../conversations";
import type { Creds } from "../creds";
import type { TranscriberFor } from "../dictate";
import type { Git } from "../git";
import type { Slot } from "../ports";
import type { Journal } from "../records";
import type { Storage } from "../storage";
import type { WorktreeService } from "../tasks";
import type { AccessConfig, TunnelConfig } from "../tunnel";
import type {
	CoordinatorState,
	DevWorkers,
	MachineSensors,
	WorkerMachine,
} from "../workers";
import type { Project } from "./project";
import type { ServerChoice } from "./servers";

/** What `dev` lets a caller choose. */
export interface DevOptions {
	/**
	 * Where the local worker dials in, a Unix socket path; without it, workers
	 * reach this server only through `/api/workers`.
	 */
	workerSocket?: string | null;
	/** Where workers are taken in; one of its own by default. */
	workers?: DevWorkers | null;
	/**
	 * What this coordinator keeps across its restarts: the roots of the
	 * projects whose agents the last run let go of, served before the worker
	 * joins so they are taken back, and written again at the next restart;
	 * null keeps nothing, and a restart ends every agent.
	 */
	coordinator?: CoordinatorState | null;
	/**
	 * The worker agents and terminals run on, whose process table a restart
	 * reads; this machine, read directly, by default.
	 */
	worker?: WorkerMachine | null;
	/**
	 * The wildcard base host task ports are served under, as
	 * `<task>-<port>.<base>`, behind `access`; null serves them only on
	 * loopback ports here. Refused without `access`.
	 */
	portsHost?: string | null;
	/** Where to listen; the port `--port` asked for, and the span above it. */
	ports?: PortProvider;
	/**
	 * Host names besides this machine's own that the page may be reached by,
	 * like the hostname of a tunnel. Anything else is refused, which is what
	 * stops another site from reading the repo through a browser pointed at
	 * localhost. Who may use those names is the Access policy's business, not
	 * splates's.
	 */
	hosts?: string[];
	/**
	 * The Cloudflare Access application in front of `hosts`, or null for none.
	 * Given one, a request to those hosts must carry a token it signed, and
	 * then may use conversations and terminals too. Anything that exposes the
	 * page beyond this machine refuses to without it.
	 */
	access?: AccessConfig | null;
	/**
	 * The Cloudflare tunnel to run once listening, whose host `hosts` also
	 * lets in. Refused without `access`.
	 */
	tunnel?: TunnelConfig | null;
	/**
	 * Makes the conversations a project's page may hold with agents, its
	 * records in `splatesDir`, its commands watched through `git`, its limits
	 * from `config`, its agents placed on a remote worker in its tasks'
	 * clones that `service` records; without it no page has any to show, and the routes
	 * say they are off.
	 */
	conversations?:
		| ((project: {
				splatesDir: string;
				storage: Storage;
				git: Git;
				config: Config;
				creds: Creds;
				/** Its tasks, for where its agents start on a remote worker. */
				service: WorktreeService;
				/** Where what its agents do is logged. */
				journal: Journal;
		  }) => Conversations)
		| null;
	/**
	 * The shell a page's terminal runs, as argv, in the main tree or a task's
	 * worktree; without it, the page has no terminal and the route says so.
	 */
	shell?: string[] | null;
	/**
	 * What a project's dictations transcribe with, by default OpenAI on the
	 * key its creds keep; a test hands in a fake.
	 */
	transcriber?: TranscriberFor;
	/** Opens a registered project by its root; `openRepository` by default. */
	open?: (root: string) => Promise<Project>;
	/**
	 * The latest splates on npm, or null when it cannot say, asked as the server
	 * starts and hourly after; the page hints at a restart once it is past
	 * `running`. Without it, nothing is checked.
	 */
	newest?: () => Promise<string | null>;
	/** The version serving; the one installed by default. */
	running?: string;
	/** How often `newest` is asked after the first time: hourly by default. */
	checkEvery?: Duration;
	/**
	 * The last commit to splates's own source, or null when it does not run
	 * from a checkout. Asked as the server starts, then every `sourceEvery`;
	 * once it moves on, the page hints at a restart. A server started from a
	 * checkout asks this in place of `newest`, since a restart runs the
	 * checkout again. Without it, nothing is checked.
	 */
	source?: () => Promise<string | null>;
	/** How often `source` is asked after the first time. */
	sourceEvery?: Duration;
	/**
	 * Whether building the page failed before this start, so what it serves
	 * is the page built before; the page says so.
	 */
	unbuilt?: boolean;
	/** The slot `splates server --slot` serves under, which the page shows; null for none. */
	slot?: Slot | null;
	/**
	 * Every `splates server` on this machine, the machine's own and each slot's,
	 * which the page's switcher lists beside the projects; none by default.
	 */
	servers?: () => Promise<ServerChoice[]>;
	/**
	 * Ends the process with `RESTART` or `UPDATE` once the server has
	 * stopped, for its supervisor to start another; without it, the page
	 * cannot restart `splates server`.
	 */
	exit?: ((code: number) => void) | null;
	/** How long a restart or shutdown waits on checkpoints and on stopping before going on without them; five minutes for none. */
	deadlineMs?: number;
	/** Where the page's machine stats come from; this machine's OS for none. */
	sensors?: MachineSensors | null;
	/** Whose test runs and installs the page shows; this machine's for none. */
	heavy?: Pick<HeavyCap, "read"> | null;
	/** What pushes notices to the devices that subscribed; the Web Push services by default. */
	pusher?: (keys: VapidKeys) => Pusher;
}
