import type { AsyncResource } from "webappwiz/disposable";
import { RUNNER_WAITS_HEADER } from "./fly-runners";

/**
 * A runner made for a checkout, as its boot leaves it: it answers 409 until
 * its build is `PUT`, then takes the job channel's WebSocket. It keeps each
 * build it is handed.
 */
export class FakeAwaitingRunner implements AsyncResource {
	readonly builds: Uint8Array[] = [];
	private readonly server: Bun.Server<undefined>;

	constructor(secret: string) {
		this.server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request, server) => this.answer(request, server, secret),
			websocket: { message: () => {} },
		});
	}

	get address(): string {
		return `http://127.0.0.1:${this.server.port}`;
	}

	async disposeAsync(): Promise<void> {
		await this.server.stop(true);
	}

	private async answer(
		request: Request,
		server: Bun.Server<undefined>,
		secret: string,
	): Promise<Response | undefined> {
		if (request.headers.get("authorization") !== `Bearer ${secret}`) {
			return new Response("unauthorized", { status: 401 });
		}
		if (request.method === "PUT") {
			this.builds.push(new Uint8Array(await request.arrayBuffer()));
			return new Response("installed");
		}
		if (this.builds.length === 0) {
			return new Response("waiting", {
				status: 409,
				headers: { [RUNNER_WAITS_HEADER]: "build" },
			});
		}
		return server.upgrade(request, { data: undefined })
			? undefined
			: new Response("a WebSocket is required", { status: 426 });
	}
}
