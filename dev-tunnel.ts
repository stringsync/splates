import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Ps } from "webappwiz/system";
import type { AccessConfig } from "./dev-access";
import { fail } from "./exit";

/** The Cloudflare tunnel `arbor dev` runs to reach the page from elsewhere. */
export interface TunnelConfig {
	/** The public hostname the tunnel's DNS route points at. */
	host: string;
	/** The named tunnel to run, or null for the one `cloudflared`'s config names. */
	name: string | null;
}

/**
 * The tunnel `--tunnel` and `--tunnel-name` ask for, or null when no host is
 * given. Refused without `access`, so a tunnel never exposes the page to
 * anyone Cloudflare Access has not let in.
 */
export function tunnelConfig(
	host: string,
	name: string,
	access: AccessConfig | null,
): TunnelConfig | null {
	host = host.trim().toLowerCase();
	name = name.trim();
	if (host === "") {
		if (name !== "") {
			fail("usage", "--tunnel-name needs --tunnel, the hostname it serves", {
				name,
			});
		}
		return null;
	}
	if (!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(host)) {
		fail(
			"usage",
			`invalid tunnel host '${host}': use a host name, as in arbor.example.com`,
			{ host },
		);
	}
	if (access === null) {
		fail(
			"usage",
			"--tunnel exposes this machine's page, so it needs Cloudflare Access in front: add --access-team and --access-aud",
			{ host },
		);
	}
	return { host, name: name === "" ? null : name };
}

/** What `cloudflared` prints once a connection to Cloudflare's edge is up. */
const REGISTERED = "Registered tunnel connection";

/** How much of `cloudflared`'s stderr is kept to explain how it died. */
const STDERR_CHARS = 2_000;

/**
 * A `cloudflared tunnel run` carrying `config.host` to `port` on this machine,
 * for as long as the server lives. One that cannot start or dies later is
 * logged, never fatal: the page still answers on this machine.
 */
export class Tunnel implements AsyncResource {
	private constructor(private readonly child: Child) {}

	static start(
		ps: Ps,
		log: Logger,
		config: TunnelConfig,
		port: number,
	): Tunnel {
		const argv = [
			"cloudflared",
			"tunnel",
			"--no-autoupdate",
			"run",
			"--url",
			`http://localhost:${port}`,
			...(config.name === null ? [] : [config.name]),
		];
		const child = ps.start(argv);
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
					log.info(`arbor dev reachable at https://${config.host}`);
				}
			}
		})().catch(() => {});
		void (async () => {
			let code: number;
			try {
				code = await child.exited;
			} catch (error) {
				log.error(
					`cloudflared did not start: ${error instanceof Error ? error.message : String(error)}. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ to use --tunnel.`,
				);
				return;
			}
			await watched;
			// A stop the server asked for is no failure.
			if (code === 0 || code === 143) {
				return;
			}
			log.error(
				`cloudflared exited with ${code}, so ${config.host} is not served.${hint(tail)}\n${tail.trim()}`,
			);
		})();
		return new Tunnel(child);
	}

	async disposeAsync(): Promise<void> {
		this.child.kill();
		await this.child.exited.catch(() => 0);
	}
}

/** What to do about the way `cloudflared` said it failed. */
function hint(stderr: string): string {
	return /cert\.pem|credentials|origin certificate|login/i.test(stderr)
		? " It is not logged in or lacks that tunnel's credentials: run `cloudflared tunnel login` and `cloudflared tunnel create`."
		: "";
}
