import type { Resource } from "webappwiz/disposable";
import type { Pusher, VapidKeys } from "webappwiz/push";
import type { PortProvider } from "webappwiz/system";
import type { Duration } from "webappwiz/time";
import type { Conversations } from "./conversations";
import type { AccessConfig } from "./dev-access";
import type { Pages } from "./dev-pages";
import type { Project } from "./dev-project";
import type { ServerChoice } from "./dev-servers";
import type { TranscriberFor } from "./dev-transcriber";
import type { TunnelConfig } from "./dev-tunnel";
import type { Git } from "./git";
import type { HeavyCap } from "./heavy";
import type { MachineSensors } from "./machine";
import type { Slot } from "./slots";

/** What `dev` lets a caller choose. */
export interface DevOptions {
	/**
	 * Where the local worker dials in, a Unix socket path; without it, workers
	 * reach this server only through `/api/workers`.
	 */
	workerSocket?: string | null;
	/** Where to listen; the port `--port` asked for, and the span above it. */
	ports?: PortProvider;
	/**
	 * Host names besides this machine's own that the page may be reached by,
	 * like the hostname of a tunnel. Anything else is refused, which is what
	 * stops another site from reading the repo through a browser pointed at
	 * localhost. Who may use those names is the Access policy's business, not
	 * arbor's.
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
	 * records in `arborDir`, its commands watched through `git`; without it no page has any to show, and the routes
	 * say they are off.
	 */
	conversations?:
		| ((project: { arborDir: string; git: Git }) => Conversations)
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
	 * The latest arbor on npm, or null when it cannot say, asked as the server
	 * starts and hourly after; the page hints at a restart once it is past
	 * `running`. Without it, nothing is checked.
	 */
	newest?: () => Promise<string | null>;
	/** The version serving; the one installed by default. */
	running?: string;
	/** How often `newest` is asked after the first time: hourly by default. */
	checkEvery?: Duration;
	/**
	 * The last commit to arbor's own source, or null when it does not run
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
	/**
	 * Starts what rebuilds the page as its source changes, handing it the
	 * pages to serve what it built; stopped with the server. None for a
	 * server that runs no checkout.
	 */
	rebuilds?: ((pages: Pages) => Resource) | null;
	/** The slot `arbor dev --slot` serves under, which the page shows; null for none. */
	slot?: Slot | null;
	/**
	 * Every `arbor dev` on this machine, the machine's own and each slot's,
	 * which the page's switcher lists beside the projects; none by default.
	 */
	servers?: () => Promise<ServerChoice[]>;
	/**
	 * Ends the process with `RESTART` or `UPDATE` once the server has
	 * stopped, for its supervisor to start another; without it, the page
	 * cannot restart `arbor dev`.
	 */
	exit?: ((code: number) => void) | null;
	/** Where the page's machine stats come from; this machine's OS for none. */
	sensors?: MachineSensors | null;
	/** Whose test runs and installs the page shows; this machine's for none. */
	heavy?: Pick<HeavyCap, "read"> | null;
	/** What pushes notices to the devices that subscribed; the Web Push services by default. */
	pusher?: (keys: VapidKeys) => Pusher;
}
