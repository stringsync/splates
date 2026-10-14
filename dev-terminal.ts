import { z } from "zod";
import { type HostGate, json, refuse } from "./dev-http";
import type { Served } from "./dev-project";
import { fail } from "./exit";
import { Pty } from "./pty";

/** What a terminal's socket carries: where its shell runs, and the shell. */
export interface TerminalData {
	cwd: string;
	cols: number;
	rows: number;
	pty: Pty | null;
}

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
	readonly open = (request: Request, server: Bun.Server<TerminalData>) =>
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
				const data = {
					cwd,
					cols: dimension(params.get("cols"), 80),
					rows: dimension(params.get("rows"), 24),
					pty: null,
				};
				// Bun answers an upgrade itself, so there is nothing to return.
				return server.upgrade(request, { data })
					? undefined
					: refuse(400, "usage", "a terminal is a WebSocket: connect with one");
			}),
		)(request);

	// Bytes both ways are the terminal's own; text is for what is not, as
	// JSON: a resize from the page, the shell's exit code from here.
	readonly websocket: Bun.WebSocketHandler<TerminalData> = {
		open: (socket) => {
			const { cwd, cols, rows } = socket.data;
			const pty = new Pty({ argv: this.shell ?? [], cwd, cols, rows });
			socket.data.pty = pty;
			this.shells.add(pty);
			pty.events.on("data", (bytes) => socket.sendBinary(bytes));
			pty.events.on("exit", (code) => {
				socket.send(JSON.stringify({ type: "exit", code }));
				socket.close();
			});
		},
		message: (socket, message) => {
			const pty = socket.data.pty;
			if (pty === null) {
				return;
			}
			if (typeof message !== "string") {
				pty.write(message);
				return;
			}
			const parsed = TerminalMessage.safeParse(json(message));
			if (parsed.success) {
				pty.resize(parsed.data.cols, parsed.data.rows);
			}
		},
		close: (socket) => {
			const pty = socket.data.pty;
			if (pty !== null) {
				this.shells.delete(pty);
				void pty.disposeAsync();
			}
		},
	};

	async disposeAsync(): Promise<void> {
		await Promise.all([...this.shells].map((pty) => pty.disposeAsync()));
	}
}

/** Bigger than any screen, and small enough that a typo cannot hurt. */
const MAX_SIZE = 1000;

/** The one thing a page says to its terminal that is not typing. */
const TerminalMessage = z.object({
	type: z.literal("resize"),
	cols: z.number().int().min(1).max(MAX_SIZE),
	rows: z.number().int().min(1).max(MAX_SIZE),
});

/** A terminal's size as the page asked for it, or `fallback` for nonsense. */
function dimension(asked: string | null, fallback: number): number {
	const value = Number(asked);
	return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
		? value
		: fallback;
}
