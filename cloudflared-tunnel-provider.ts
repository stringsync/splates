import type { AsyncResource } from "webappwiz/disposable";
import type { Ps } from "webappwiz/system";
import type { TunnelProvider, TunnelRoute } from "./tunnel-provider";

/** What `cloudflared` prints once a connection to Cloudflare's edge is up. */
const REGISTERED = "Registered tunnel connection";

/** How much of `cloudflared`'s stderr is kept to explain how it died. */
const STDERR_CHARS = 2_000;

/** Cloudflare's own page, which covers every platform. */
const DOWNLOADS =
	"https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

/**
 * A TunnelProvider over the `cloudflared` binary, running the named tunnel
 * the account already has, or the one its own config names, or, given a
 * token, the tunnel `arbor tunnel setup` made, with no login or credentials
 * file. One that dies while running is logged, never fatal: the page still
 * answers on this machine.
 */
export class CloudflaredTunnelProvider implements TunnelProvider {
	constructor(
		private readonly ps: Ps,
		private readonly name: string | null = null,
		/** The tunnel's token, handed over in the environment, never the argv `ps` lists. */
		private readonly token: string | null = null,
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
		const argv = [
			"cloudflared",
			"tunnel",
			"--no-autoupdate",
			"run",
			"--url",
			url,
			...(this.name === null ? [] : [this.name]),
		];
		const child = this.ps.start(
			argv,
			this.token === null ? undefined : { env: { TUNNEL_TOKEN: this.token } },
		);
		let tail = "";
		const watched = (async () => {
			const decoder = new TextDecoder();
			let line = "";
			for await (const chunk of child.stderr) {
				const text = decoder.decode(chunk);
				tail = (tail + text).slice(-STDERR_CHARS);
				line += text;
				const lines = line.split("\n");
				line = lines.pop() ?? "";
				if (lines.some((each) => each.includes(REGISTERED))) {
					log.info(`arbor dev reachable at https://${host}`);
				}
			}
		})().catch(() => {});
		void (async () => {
			let code: number;
			try {
				code = await child.exited;
			} catch (error) {
				log.error(
					`cloudflared did not start: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
			await watched;
			// A stop the server asked for is no failure.
			if (code === 0 || code === 143) {
				return;
			}
			log.error(
				`cloudflared exited with ${code}, so ${host} is not served.${this.token === null ? hint(tail) : TOKEN_HINT}\n${tail.trim()}`,
			);
		})();
		return {
			disposeAsync: async () => {
				child.kill();
				await child.exited.catch(() => 0);
			},
		};
	}
}

/** What to do about a tunnel `arbor tunnel setup` made that will not run. */
const TOKEN_HINT =
	" Run `arbor tunnel setup` again to check the tunnel and fetch its token anew.";

/** What to do about the way `cloudflared` said it failed. */
function hint(stderr: string): string {
	return /cert\.pem|credentials|origin certificate|login/i.test(stderr)
		? " It is not logged in or lacks that tunnel's credentials: run `cloudflared tunnel login` and `cloudflared tunnel create`."
		: "";
}
