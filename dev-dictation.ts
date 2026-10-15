import { isCleanupKind, isCleanupModel } from "./cleanup-models";
import { DictationConnection } from "./dev-dictation-connection";
import { type HostGate, refuse } from "./dev-http";
import type { Served } from "./dev-project";
import type { Connection } from "./dev-sockets";

/** How a dictation finds the project its request names. */
export interface DictationProjects {
	projectFor(request: Request): Promise<Served>;
}

/**
 * The composer's dictations, each over a WebSocket: the page streams the
 * mic's audio up, and the text comes back as it is heard.
 */
export class Dictations {
	constructor(
		private readonly gate: HostGate,
		private readonly projects: DictationProjects,
	) {}

	// A take spends the person's OpenAI key, so it gets the conversations'
	// rule (this machine's own names, or Access) and an Origin check of its
	// own, as a terminal does: without it any site they visit could dictate.
	readonly open = (request: Request, server: Bun.Server<Connection>) =>
		this.gate.local(
			this.gate.guarded(async (request): Promise<Response | undefined> => {
				const host = request.headers.get("host") ?? "";
				const origin = URL.parse(request.headers.get("origin") ?? "");
				if (origin === null || origin.host !== host) {
					return refuse(
						403,
						"forbidden",
						"a dictation opens only from its own page",
					);
				}
				const project = await this.projects.projectFor(request);
				// The page names the model its Settings picked for the cleanups.
				const { searchParams } = new URL(request.url);
				const model = searchParams.get("model") ?? "";
				// And the cleanups it switched off, by what each edits.
				const off = new Set(
					(searchParams.get("off") ?? "").split(",").filter(isCleanupKind),
				);
				const data = new DictationConnection(
					project.transcriber(),
					project.cleanup(isCleanupModel(model) ? model : undefined, off),
				);
				// Bun answers an upgrade itself, so there is nothing to return.
				return server.upgrade(request, { data })
					? undefined
					: refuse(
							400,
							"usage",
							"a dictation is a WebSocket: connect with one",
						);
			}),
		)(request);
}
