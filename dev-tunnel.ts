import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { CloudflaredTunnelProvider } from "./cloudflared-tunnel-provider";
import type { AccessConfig } from "./dev-access";
import { fail } from "./exit";
import type { TunnelProvider } from "./tunnel-provider";

/** The tunnel `arbor dev` runs to reach the page from elsewhere. */
export interface TunnelConfig {
	/** The public hostname the tunnel carries to the page. */
	host: string;
	provider: TunnelProvider;
}

/**
 * The tunnel `--tunnel` and `--tunnel-name` ask for, or null when no host is
 * given, run by `custom`, the provider `arbor.config.ts` names, or else by
 * `cloudflared`. Refused without `access`, so a tunnel never exposes the page
 * to anyone Cloudflare Access has not let in.
 */
export function tunnelConfig(
	host: string,
	name: string,
	access: AccessConfig | null,
	custom: TunnelProvider | null,
	ps: Ps,
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
	if (custom !== null && name !== "") {
		fail(
			"usage",
			"--tunnel-name names a cloudflared tunnel, but arbor.config.ts gives its own tunnel provider",
			{ name },
		);
	}
	return {
		host,
		provider: custom ?? new CloudflaredTunnelProvider(ps, name || null),
	};
}

/**
 * Starts `tunnel` carrying its host to `url`, once the page listens. A provider
 * that is not ready, or that cannot start, is logged and skipped, never fatal:
 * the page still answers on this machine. The run is what to dispose of with
 * the server, or null when there is none.
 */
export async function startTunnel(
	tunnel: TunnelConfig,
	url: string,
	log: Logger,
): Promise<AsyncResource | null> {
	try {
		await tunnel.provider.ready();
		return tunnel.provider.run({ host: tunnel.host, url, log });
	} catch (error) {
		log.error(
			`${tunnel.host} is not served: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}
