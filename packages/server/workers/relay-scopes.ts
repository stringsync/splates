import type { Resource } from "webappwiz/disposable";

/**
 * Which project each connection a worker's relay made is limited to, by the
 * local port this end connected to its own server from: the server reads a
 * request's port off its socket, so what a worker said of a connection
 * holds for every request on it. A connection of `splates` run by hand has
 * no entry, and is limited to nothing.
 */
export class RelayScopes {
	private readonly byPort = new Map<number, string>();

	/** Limits the connection made from `port` to `project`, until disposed. */
	hold(port: number, project: string): Resource {
		this.byPort.set(port, project);
		return {
			dispose: () => {
				if (this.byPort.get(port) === project) {
					this.byPort.delete(port);
				}
			},
		};
	}

	/** The project the connection from `port` is limited to, null when to none. */
	of(port: number | null | undefined): string | null {
		return port === null || port === undefined
			? null
			: (this.byPort.get(port) ?? null);
	}
}
