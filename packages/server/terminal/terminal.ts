import { Exit, fail } from "../exit";
import { body, eventStream } from "../server/http";
import type { Connection, EventSink, Served } from "../server/shared";
import { type HostGate, refuse } from "../server/shared";
import { TerminalConnection } from "./connection";
import { type KeptShell, MAX_SIZE, Shell, type ShellHost } from "./shell";

/** How a terminal finds the project its request names. */
export interface TerminalProjects {
	projectFor(request: Request): Promise<Served>;
	/**
	 * The root of the project `request` names, read without opening it: where
	 * a shell starts in one whose records failed to migrate.
	 */
	unopened?(request: Request): Promise<string>;
}

/**
 * The shells a page opens over `/api/terminal`, each in the main tree or a
 * task's worktree. Open one with `?terminal=<key>` to come back to it by
 * that key after a reload or a restart of `splates server`, from any page:
 * a keyed shell belongs to its project, not to the page that made it, so
 * `list` says which are up, `name` names one for every page, and `events`
 * tells the pages when any of that changes. `handOver` and `takeBack` carry
 * keyed shells across the restart, and `disposeAsync` hangs up on them all.
 */
export class Terminals {
	private readonly shells = new Set<Shell>();
	private readonly pages = new Set<EventSink>();

	constructor(
		private readonly gate: HostGate,
		private readonly shell: string[] | null,
		private readonly projects: TerminalProjects,
		/** The worker the shells run on, whose process table says their jobs in front. */
		private readonly worker: ShellHost,
	) {}

	/**
	 * Takes back the shells the last run let go of, each staying for its page
	 * to come back; before the worker joins, whose hello says which it kept.
	 */
	takeBack(kept: KeptShell[]): void {
		for (const { key, handle, name } of kept) {
			const shell = new Shell(
				key,
				this.worker.resumePty(handle),
				this.worker,
				(gone) => this.dropped(gone),
			);
			// A key from before shells were shared names a browser tab, which
			// no page finds again.
			if (!key.includes(SEPARATOR)) {
				void shell.disposeAsync();
				continue;
			}
			shell.name = name ?? null;
			this.shells.add(shell);
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
				const page = params.get("terminal");
				const key =
					page === null ? null : shellKey(params.get("project"), page);
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
				const cwd = await this.treeFor(request);
				const shell = new Shell(
					key,
					this.worker.pty({
						argv: this.shell ?? [],
						cwd,
						cols: dimension(params.get("cols"), 80),
						rows: dimension(params.get("rows"), 24),
					}),
					this.worker,
					(gone) => this.dropped(gone),
				);
				this.shells.add(shell);
				this.changed(shell.key);
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

	/** The keyed shells of the project `request` names, which any page may show. */
	readonly list = (request: Request) =>
		this.gate.local(
			this.gate.guarded(async (request): Promise<Response> => {
				const project = new URL(request.url).searchParams.get("project");
				const terminals = [...this.shells].flatMap((shell) => {
					const key = shell.key === null ? null : pageKey(project, shell.key);
					return key === null ? [] : [{ key, name: shell.name }];
				});
				return Response.json({ terminals });
			}),
		)(request);

	/** The stream that says a project's terminals changed, for the pages to list again. */
	readonly events = (request: Request) =>
		this.gate.local(this.gate.guarded(async () => eventStream(this.pages)))(
			request,
		);

	/** Names a terminal for every page, or, given a blank name, goes back to its default. */
	readonly rename = (request: Request) =>
		this.gate.local(
			this.gate.guarded(async (request): Promise<Response> => {
				const project = new URL(request.url).searchParams.get("project");
				const { key, name } = await body(request);
				if (typeof key !== "string" || typeof name !== "string") {
					return refuse(400, "usage", "a name needs a key and a name");
				}
				const wanted = shellKey(project, key);
				const shell = [...this.shells].find((each) => each.key === wanted);
				if (shell === undefined) {
					return refuse(404, "not_found", "no such terminal");
				}
				shell.name = name.trim() === "" ? null : name.trim();
				this.changed(wanted);
				return Response.json({});
			}),
		)(request);

	/** Drops a shell that is gone, and says so. */
	private dropped(shell: Shell): void {
		if (this.shells.delete(shell)) {
			this.changed(shell.key);
		}
	}

	/** Tells every page the terminals of `key`'s project changed. */
	private changed(key: string | null): void {
		if (key === null || !key.includes(SEPARATOR)) {
			return;
		}
		const project = key.slice(0, key.indexOf(SEPARATOR));
		const bytes = new TextEncoder().encode(
			`event: terminals\ndata: ${JSON.stringify({ project })}\n\n`,
		);
		for (const sink of this.pages) {
			sink.enqueue(bytes);
		}
	}

	/**
	 * Where a new shell for `request` starts: the tree it names in its
	 * project, or the project's root when its records failed to migrate, so
	 * an agent can be started there to fix them.
	 */
	private async treeFor(request: Request): Promise<string> {
		try {
			const project = await this.projects.projectFor(request);
			await project.format.check();
			return await project.terminalTree(request);
		} catch (error) {
			if (
				error instanceof Exit &&
				error.reason === "migration_failed" &&
				this.projects.unopened !== undefined
			) {
				return this.projects.unopened(request);
			}
			throw error;
		}
	}

	async disposeAsync(): Promise<void> {
		await Promise.all([...this.shells].map((shell) => shell.disposeAsync()));
	}
}

/** Between a shell's project and the key its pages know it by. */
const SEPARATOR = "|";

/** The key a shell of `project` goes by on the server, for the `key` its pages use. */
function shellKey(project: string | null, key: string): string {
	return `${project ?? ""}${SEPARATOR}${key}`;
}

/** The key pages use for a shell keyed `key` on the server, or null when it is another project's. */
function pageKey(project: string | null, key: string): string | null {
	const prefix = `${project ?? ""}${SEPARATOR}`;
	return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/** A terminal's size as the page asked for it, or `fallback` for nonsense. */
function dimension(asked: string | null, fallback: number): number {
	const value = Number(asked);
	return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
		? value
		: fallback;
}
