import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";

/** What a provider is asked to publish. */
export interface TunnelRoute {
	/** The public host name that must reach `url`. */
	host: string;
	/** The page on this machine, `http://localhost:<port>`. */
	url: string;
	/** Where the provider says what it is doing, such as where it is reachable. */
	log: Logger;
}

/**
 * TunnelProvider is the seam onto whatever puts the `arbor dev` page on a
 * public host name: `cloudflared` by default, or any tunnel a repo's
 * `arbor.config.ts` names as `tunnel`:
 *
 * ```ts
 * export default { tunnel: new MyTunnel() } satisfies ConfigFile;
 * ```
 *
 * Whatever it is, `--tunnel` still refuses to run without Cloudflare Access in
 * front, which is what decides who may enter; a provider only carries traffic.
 */
export interface TunnelProvider {
	/**
	 * Throws unless whatever runs the tunnel is installed and signed in, with a
	 * message saying what to do about it. Asked before `run`, which is skipped
	 * when it throws: the page keeps serving on this machine.
	 */
	ready(): Promise<void>;
	/**
	 * Starts carrying `route.host` to `route.url`, and answers with the run,
	 * which serves until it is disposed of. Disposing stops the tunnel and
	 * returns once it is gone; disposing one that stopped on its own is silent.
	 */
	run(route: TunnelRoute): AsyncResource;
}
