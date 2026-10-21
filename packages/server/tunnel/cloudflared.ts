import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Ps } from "webappwiz/system";
import type { TunnelProvider, TunnelRoute } from "./provider";

/** What `cloudflared` prints once a connection to Cloudflare's edge is up. */
const REGISTERED = "Registered tunnel connection";

/** How much of `cloudflared`'s stderr is kept to explain how it died. */
const STDERR_CHARS = 2_000;

/** A cloudflared that dies sooner than this after starting counts as a fast failure. */
const STABLE_MS = 30_000;

/** Fast failures in a row after which the server exits rather than keep restarting. */
const MAX_FAST_FAILURES = 5;

/** The wait before the first restart, doubling for each fast failure after. */
const BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** Cloudflare's own page, which covers every platform. */
const DOWNLOADS =
	"https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

/**
 * An `sh -c` script that runs the command after it, `sh -c GUARD sh <argv>`,
 * until the guard's stdin closes or a SIGTERM reaches it, and exits with the
 * command's status. Start it with stdin a pipe, so it dies with its parent.
 */
export const GUARD = [
	// A pipe's write end closes however its owner dies, kill -9 included, so
	// a crashed splates server leaves no connector serving its tunnel to a dead port.
	"exec 3<&0",
	'"$@" 3<&- & c=$!',
	"trap 'kill $c 2>/dev/null' HUP INT TERM",
	"{ cat <&3; kill $c; } >/dev/null 2>&1 & w=$!",
	"exec 3<&-",
	// a SIGTERM interrupts the wait, so wait again for the status
	"while wait $c; s=$?; kill -0 $c 2>/dev/null; do :; done",
	// so the watch never kills another process given the pid later
	"kill $w 2>/dev/null",
	"exit $s",
].join("\n");

/**
 * A TunnelProvider over the `cloudflared` binary, running the named tunnel
 * the account already has, or the one its own config names, or, given a
 * token, the tunnel `splates tunnel setup` made, with no login or credentials
 * file. One that dies while running is logged and restarted with
 * backoff; after repeated fast failures the server exits, so its supervisor
 * restarts the whole unit. Until then the page still answers on this machine.
 */
export class CloudflaredTunnelProvider implements TunnelProvider {
	constructor(
		private readonly ps: Ps,
		private readonly name: string | null = null,
		/** The tunnel's token, handed over in the environment, never the argv `ps` lists. */
		private readonly token: string | null = null,
		private readonly opts: CloudflaredOptions = {},
	) {}

	async ready(): Promise<void> {
		// Asked of `which`, since a missing executable makes a spawn throw and
		// that throw says only what any other spawn failure says.
		const { exitCode } = await this.ps.spawnCapture([
			this.ps.platform === "win32" ? "where" : "which",
			"cloudflared",
		]);
		if (exitCode !== 0) {
			throw new Error(
				`cloudflared is not installed: install it from ${DOWNLOADS} to use --tunnel`,
			);
		}
	}

	run({ host, url, log }: TunnelRoute): AsyncResource {
		const command = [
			"cloudflared",
			"tunnel",
			"--no-autoupdate",
			"run",
			"--url",
			url,
			...(this.name === null ? [] : [this.name]),
		];
		// Windows has no sh, so there cloudflared runs bare and can outlive a crash.
		const argv =
			this.ps.platform === "win32"
				? command
				: ["sh", "-c", GUARD, "sh", ...command];
		let disposed = false;
		let current: Child | null = null;
		const start = () =>
			this.ps.start(
				argv,
				this.token === null ? undefined : { env: { TUNNEL_TOKEN: this.token } },
			);
		const supervise = async () => {
			let failures = 0;
			while (!disposed) {
				const child = start();
				current = child;
				const startedAt = Date.now();
				const tail = await this.watch(child, host, log);
				if (tail === null || disposed) {
					return;
				}
				const { code, text } = tail;
				// A stop the server asked for is no failure.
				if (code === 0 || code === 143) {
					return;
				}
				failures = Date.now() - startedAt < STABLE_MS ? failures + 1 : 1;
				const exited = `cloudflared exited with ${code}, so ${host} is not served.${this.token === null ? hint(text) : TOKEN_HINT}\n${text.trim()}`;
				if (failures >= MAX_FAST_FAILURES) {
					log.error(
						`${exited}\ncloudflared failed ${failures} times in a row, each within ${STABLE_MS / 1000}s of starting: exiting splates server so its supervisor restarts it whole.`,
					);
					this.ps.exit(1);
					return;
				}
				const delay = Math.min(
					BACKOFF_MS * 2 ** (failures - 1),
					MAX_BACKOFF_MS,
				);
				log.error(`${exited}\nRestarting cloudflared in ${delay / 1000}s.`);
				await (this.opts.waiter ?? REAL_WAITER).wait(delay);
			}
		};
		void supervise();
		return {
			disposeAsync: async () => {
				disposed = true;
				const child = current;
				if (child === null) {
					return;
				}
				// Closing stdin also ends the guard's watch on it.
				void child.stdin.close().catch(() => {});
				child.kill();
				await child.exited.catch(() => 0);
			},
		};
	}

	/**
	 * Reads `child`'s stderr until it exits, saying once where the page is up,
	 * and returns its exit code with the tail of what it printed, or null
	 * when it never started.
	 */
	private async watch(
		child: Child,
		host: string,
		log: Logger,
	): Promise<{ code: number; text: string } | null> {
		let tail = "";
		// cloudflared opens several connections to the edge, each registered
		// on a line of its own, so only the first says the page is up.
		let reached = false;
		const watched = (async () => {
			const decoder = new TextDecoder();
			let line = "";
			for await (const chunk of child.stderr) {
				const text = decoder.decode(chunk);
				tail = (tail + text).slice(-STDERR_CHARS);
				line += text;
				const lines = line.split("\n");
				line = lines.pop() ?? "";
				if (!reached && lines.some((each) => each.includes(REGISTERED))) {
					reached = true;
					log.info(`splates server reachable at https://${host}`);
				}
			}
		})().catch(() => {});
		let code: number;
		try {
			code = await child.exited;
		} catch (error) {
			log.error(
				`cloudflared did not start: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
		await watched;
		return { code, text: tail };
	}
}

/** Waits out a restart's backoff. */
export interface Waiter {
	wait(ms: number): Promise<void>;
}

const REAL_WAITER: Waiter = { wait: (ms) => Bun.sleep(ms) };

export interface CloudflaredOptions {
	/** Tests pass one that returns at once. */
	waiter?: Waiter;
}

/** What to do about a tunnel `splates tunnel setup` made that will not run. */
const TOKEN_HINT =
	" Run `splates tunnel setup` again to check the tunnel and fetch its token anew.";

/** What to do about the way `cloudflared` said it failed. */
function hint(stderr: string): string {
	return /cert\.pem|credentials|origin certificate|login/i.test(stderr)
		? " It is not logged in or lacks that tunnel's credentials: run `cloudflared tunnel login` and `cloudflared tunnel create`."
		: "";
}
