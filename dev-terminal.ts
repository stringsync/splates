import { SystemTimer, type Timer } from "webappwiz/time";
import { type HostGate, refuse } from "./dev-http";
import type { Served } from "./dev-project";
import { type KeptShell, MAX_SIZE, Shell, type ShellHost } from "./dev-shell";
import type { Connection } from "./dev-sockets";
import { TerminalConnection } from "./dev-terminal-connection";
import { fail } from "./exit";

/** How a terminal finds the project its request names. */
export interface TerminalProjects {
	projectFor(request: Request): Promise<Served>;
}

/**
 * The shells a page opens over `/api/terminal`, each in the main tree or a
 * task's worktree. Open one with `?terminal=<key>` to come back to it by
 * that key after a reload or a restart of `arbor dev`; `handOver` and
 * `takeBack` carry keyed shells across the restart, and `disposeAsync`
 * hangs up on them all.
 */
export class Terminals {
	private readonly shells = new Set<Shell>();
	private readonly timer: Timer;

	constructor(
		private readonly gate: HostGate,
		private readonly shell: string[] | null,
		private readonly projects: TerminalProjects,
		/** The worker the shells run on, whose process table says their jobs in front. */
		private readonly worker: ShellHost,
		{ timer = new SystemTimer() }: { timer?: Timer } = {},
	) {
		this.timer = timer;
	}

	/**
	 * Takes back the shells the last run let go of, each waiting for its page
	 * to come back; before the worker joins, whose hello says which it kept.
	 */
	takeBack(kept: KeptShell[]): void {
		for (const { key, handle } of kept) {
			const shell = new Shell(
				key,
				this.worker.resumePty(handle),
				this.worker,
				this.timer,
				(gone) => this.shells.delete(gone),
			);
			this.shells.add(shell);
			shell.wait();
		}
	}

	/**
	 * Lets go of every keyed shell for the next run to take back, and says
	 * which; the rest end with the server.
	 */
	handOver(): KeptShell[] {
		const kept: KeptShell[] = [];
		for (const shell of [...this.shells]) {
			const each = shell.kept;
			if (each !== null) {
				kept.push(each);
				shell.release();
			}
		}
		return kept;
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
				const params = new URL(request.url).searchParams;
				const key = params.get("terminal");
				const back = [...this.shells].find(
					(each) => key !== null && each.key === key,
				);
				if (back !== undefined) {
					return server.upgrade(request, {
						data: new TerminalConnection(back, true),
					})
						? undefined
						: refuse(
								400,
								"usage",
								"a terminal is a WebSocket: connect with one",
							);
				}
				const project = await this.projects.projectFor(request);
				await project.format.check();
				const cwd = await project.terminalTree(request);
				const shell = new Shell(
					key,
					this.worker.pty({
						argv: this.shell ?? [],
						cwd,
						cols: dimension(params.get("cols"), 80),
						rows: dimension(params.get("rows"), 24),
					}),
					this.worker,
					this.timer,
					(gone) => this.shells.delete(gone),
				);
				this.shells.add(shell);
				// Bun answers an upgrade itself, so there is nothing to return.
				if (
					server.upgrade(request, {
						data: new TerminalConnection(shell, false),
					})
				) {
					return undefined;
				}
				await shell.disposeAsync();
				return refuse(
					400,
					"usage",
					"a terminal is a WebSocket: connect with one",
				);
			}),
		)(request);

	async disposeAsync(): Promise<void> {
		await Promise.all([...this.shells].map((shell) => shell.disposeAsync()));
	}
}

/** A terminal's size as the page asked for it, or `fallback` for nonsense. */
function dimension(asked: string | null, fallback: number): number {
	const value = Number(asked);
	return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
		? value
		: fallback;
}
