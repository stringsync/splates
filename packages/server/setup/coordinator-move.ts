import { dirname } from "node:path";
import type { SecretStore } from "webappwiz/creds";
import type { Fs, Ps } from "webappwiz/system";
import { coordinatorMoved, moveRecord, shellQuoted } from "../coordinator";
import { refuse, SERVING } from "../server/shared";
import { FsStorage } from "../storage";
import { SavedTunnel } from "../tunnel";

/**
 * Whether a move from this Mac stopped once the box served, before the Mac
 * joined it as a worker: deploying again finishes it.
 */
export async function moveUnfinished({
	fs,
	home,
}: {
	fs: Fs;
	home: string;
}): Promise<boolean> {
	return (await moveRecord(fs, home))?.finished === false;
}

/**
 * What the last deploy the page started said when it failed, in a line
 * saying nothing here changed, or null when it did not fail. Seen once the
 * server is started again, since the deploy stops it on its way.
 */
export async function failedMove({
	fs,
	home,
}: {
	fs: Fs;
	home: string;
}): Promise<string | null> {
	const files = moveFiles(home);
	if (!(await fs.exists(files.exit))) {
		return null;
	}
	const code = (await fs.read(files.exit)).trim();
	if (code === "" || code === "0") {
		return null;
	}
	const said = (await fs.exists(files.log))
		? (await fs.read(files.log)).trim().split("\n").slice(-LOG_LINES).join("\n")
		: "";
	return `The last deploy failed (exit ${code}) after stopping this server, which is why you restarted it. It said:\n\n${said}`;
}

/** Where a move the page started writes what it says, its pid, and its exit code. */
export function moveFiles(home: string): {
	log: string;
	pid: string;
	exit: string;
} {
	const dir = `${home}/coordinator`;
	return {
		log: `${dir}/move.log`,
		pid: `${dir}/move.pid`,
		exit: `${dir}/move.exit`,
	};
}

/** Where a move the page started stands, as `GET /api/setup/coordinator/move` answers. */
export interface MoveProgress {
	/** Whether the coordinator has moved, as `coordinatorMoved` reads it here. */
	moved: boolean;
	/** Whether that move left this Mac to finish joining the box, as `moveUnfinished` reads it. */
	unfinished: boolean;
	/** Whether a move the page started still runs here. */
	running: boolean;
	/** How the last one ended, or null while it runs or when none was started. */
	exitCode: number | null;
	/** Its last lines, oldest first. */
	log: string[];
	/** The host the saved tunnel carries, where the page finds the box once moved; null for none. */
	host: string | null;
}

/** How many of the move's last lines the page is given. */
const LOG_LINES = 20;

/**
 * The routes the Setup page deploys the server through: `start` runs
 * `splates server deploy` on its own, and `progress` says how it goes, from
 * `moveFiles`, until this server goes; the page then watches for the box on
 * the tunnel's host.
 */
// The deploy stops this server on its way, so it cannot run inside a
// request: it runs past this server's exit and the terminal's signals.
export class CoordinatorMoveRoutes {
	constructor(private readonly opts: CoordinatorMoveRoutesOptions) {}

	readonly progress = async (): Promise<Response> =>
		Response.json(await this.read());

	readonly start = async (): Promise<Response> => {
		const { fs, ps, home } = this.opts;
		const read = await this.read();
		if (read.moved && !read.unfinished) {
			return refuse(409, "moved", "The coordinator has moved onto its box.");
		}
		if (read.running) {
			return refuse(409, "running", "A move is under way already.");
		}
		const dev = this.opts.dev();
		if (dev === null) {
			return refuse(
				503,
				"starting",
				"splates server is still starting: try again in a moment.",
			);
		}
		const files = moveFiles(home);
		await fs.mkdir(dirname(files.log), { recursive: true });
		for (const path of Object.values(files)) {
			await fs.rm(path, { force: true });
		}
		const argv = [...ps.self, "server", "deploy", "--dev", dev];
		await ps.spawn(["sh", "-c", detached(argv, files)], {
			cwd: ps.cwd(),
			unset: [SERVING],
		});
		return Response.json(await this.read());
	};

	private async read(): Promise<MoveProgress> {
		const { fs, ps, home, device } = this.opts;
		const files = moveFiles(home);
		const text = async (path: string) =>
			(await fs.exists(path)) ? (await fs.read(path)).trim() : null;
		const exit = await text(files.exit);
		const pid = Number(await text(files.pid));
		const log = (await text(files.log)) ?? "";
		const saved = await SavedTunnel.in(new FsStorage(`${home}`, fs), device)
			.read()
			.catch(() => null);
		return {
			moved: await coordinatorMoved({ fs, ps, home }),
			unfinished: await moveUnfinished({ fs, home }),
			running: exit === null && pid > 0 && ps.alive(pid),
			exitCode: exit === null || exit === "" ? null : Number(exit),
			log: log === "" ? [] : log.split("\n").slice(-LOG_LINES),
			host: saved?.host ?? null,
		};
	}
}

/** What the move routes run on. */
export interface CoordinatorMoveRoutesOptions {
	fs: Fs;
	ps: Ps;
	/** splates's home. */
	home: string;
	/** The device's store, which keeps the saved tunnel's token. */
	device: SecretStore;
	/** This server's own URL, which the move stops; null until it listens. */
	dev: () => string | null;
}

/**
 * A shell line that starts `argv` in the background and returns: deaf to
 * the terminal's Ctrl-C and hang-up, its output to the log, then its exit
 * code written once it ends.
 */
export function detached(
	argv: string[],
	files: ReturnType<typeof moveFiles>,
): string {
	const quoted = shellQuoted;
	const inner = [
		"trap '' INT HUP",
		`echo $$ > ${quoted(files.pid)}`,
		`"$@" > ${quoted(files.log)} 2>&1 < /dev/null`,
		`echo $? > ${quoted(files.exit)}`,
	].join("; ");
	return `nohup sh -c ${quoted(inner)} splates-move ${argv.map(quoted).join(" ")} > /dev/null 2>&1 &`;
}
