import { type HostGate, refuse } from "./dev-http";
import type { Served } from "./dev-project";
import type { Connection } from "./dev-sockets";
import { MAX_SIZE, TerminalConnection } from "./dev-terminal-connection";
import { fail } from "./exit";
import type { Pty } from "./pty";

/** How a terminal finds the project its request names. */
export interface TerminalProjects {
	projectFor(request: Request): Promise<Served>;
}

/**
 * The shells a page opens, each over a WebSocket in the main tree or a
 * task's worktree, kept so stopping the server hangs up on them all.
 */
export class Terminals {
	// Every shell a page has open, so stopping the server hangs up on them all.
	private readonly shells = new Set<Pty>();

	constructor(
		private readonly gate: HostGate,
		private readonly shell: string[] | null,
		private readonly projects: TerminalProjects,
	) {}

	/** The pid of each shell open now. */
	get pids(): number[] {
		return [...this.shells].map((pty) => pty.pid);
	}

	// A shell runs anything typed at it, so it gets the conversations' rule (this
	// machine's own names only) and an Origin check of its own: an upgrade is a
	// GET, which `guarded` lets through from anywhere, and without the check any
	// site the person visits could open a shell here.
	readonly open = (request: Request, server: Bun.Server<Connection>) =>
		this.gate.local(
			this.gate.guarded(async (request): Promise<Response | undefined> => {
				const host = request.headers.get("host") ?? "";
				const origin = URL.parse(request.headers.get("origin") ?? "");
				if (origin === null || origin.host !== host) {
					return refuse(
						403,
						"forbidden",
						"a terminal opens only from its own page",
					);
				}
				if (this.shell === null) {
					fail("not_found", "terminals are off", {});
				}
				const project = await this.projects.projectFor(request);
				await project.format.check();
				const cwd = await project.terminalTree(request);
				const params = new URL(request.url).searchParams;
				const data = new TerminalConnection(
					this.shells,
					this.shell ?? [],
					cwd,
					dimension(params.get("cols"), 80),
					dimension(params.get("rows"), 24),
				);
				// Bun answers an upgrade itself, so there is nothing to return.
				return server.upgrade(request, { data })
					? undefined
					: refuse(400, "usage", "a terminal is a WebSocket: connect with one");
			}),
		)(request);

	async disposeAsync(): Promise<void> {
		await Promise.all([...this.shells].map((pty) => pty.disposeAsync()));
	}
}

/** A terminal's size as the page asked for it, or `fallback` for nonsense. */
function dimension(asked: string | null, fallback: number): number {
	const value = Number(asked);
	return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
		? value
		: fallback;
}
