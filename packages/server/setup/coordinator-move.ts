import { dirname } from "node:path";
import type { SecretStore } from "webappwiz/creds";
import type { Fs, Ps } from "webappwiz/system";
import { COORDINATOR_UNIT, shellQuoted, WORKER_AGENT } from "../coordinator";
import { refuse, SERVING } from "../server/shared";
import { SavedTunnel } from "../tunnel";

/**
 * Whether the coordinator has moved onto its box, read on either side of
 * the move: the box runs `splates server` under its systemd unit, and this
 * Mac carries on as its worker under a LaunchAgent. Both are the move's
 * last steps, so neither is there before it succeeds.
 */
export async function coordinatorMoved({
	fs,
	ps,
	home,
}: {
	fs: Fs;
	ps?: Ps;
	/** splates's home, under the user's own. */
	home: string;
}): Promise<boolean> {
	const user = ps?.env("HOME") ?? dirname(home);
	return (
		(await fs.exists(`/etc/systemd/system/${COORDINATOR_UNIT}.service`)) ||
		(await fs.exists(`${user}/Library/LaunchAgents/${WORKER_AGENT}.plist`))
	);
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
 * Starts `splates coordinator move` for the page, and says how it goes. The
 * move stops this server on its way, so it cannot run inside a request: it
 * runs on its own, past this server's exit and the terminal's signals,
 * writing to `moveFiles`, and the page watches it here until this server
 * goes, then watches for the box on the tunnel's host.
 */
export class CoordinatorMoveRoutes {
	constructor(private readonly opts: CoordinatorMoveRoutesOptions) {}

	readonly progress = async (): Promise<Response> =>
		Response.json(await this.read());

	readonly start = async (): Promise<Response> => {
		const { fs, ps, home } = this.opts;
		const read = await this.read();
		if (read.moved) {
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
		const argv = [...ps.self, "coordinator", "move", "--dev", dev];
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
		const saved = await new SavedTunnel(`${home}/tunnel.json`, {
			fs,
			store: device,
		})
			.read()
			.catch(() => null);
		return {
			moved: await coordinatorMoved({ fs, ps, home }),
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
