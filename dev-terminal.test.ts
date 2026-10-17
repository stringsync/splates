import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs, OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { add } from "./add";
import { dev } from "./dev";
import { terminal } from "./dev-terminal-testing";
import { serving } from "./dev-testing";
import { DevWorkers } from "./dev-workers";
import { Testing } from "./testing";
import { WorkerDaemon } from "./worker-daemon";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("dev terminal", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	/** Asks for a terminal the way a browser would, and says how it went. */
	const knock = (port: number, headers: Record<string, string>, query = "") =>
		fetch(`http://127.0.0.1:${port}/api/terminal${query}`, {
			headers: {
				connection: "Upgrade",
				upgrade: "websocket",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				origin: `http://127.0.0.1:${port}`,
				...headers,
			},
		});

	const opened = async (
		body: (port: number) => Promise<void>,
		options: { hosts?: string[] } = {},
	) => {
		// The shells run on the local worker, here in this process.
		const workers = new DevWorkers(new MemoryLogger());
		const pair = new WorkerSocketPair();
		const daemon = new WorkerDaemon(
			{ where: "memory", dial: async () => pair.worker },
			{
				id: "local",
				slots: 4,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void daemon.run();
		void workers.registry.accept(pair.coordinator, "local");
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			shell: ["/bin/sh"],
			workers,
			...options,
		});
		try {
			await body(server.port);
		} finally {
			await server.disposeAsync();
			await daemon.disposeAsync();
		}
	};

	it("says it is off unless asked for", async () => {
		await serving(deps, async (_, port) => {
			const response = await knock(port, {});

			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({
				message: "terminals are off",
			});
		});
	});

	it("runs a shell in the main tree", async () => {
		await opened(async (port) => {
			const { socket, shows } = await terminal(port);

			socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

			await shows(`at:${deps.service.git.root}`);
		});
	});

	it("runs a shell in a task's worktree", async () => {
		await add(deps, "alpha");
		const alpha = (await deps.service.find("alpha")).path;
		await opened(async (port) => {
			const { socket, shows } = await terminal(port, "?task=alpha");

			socket.send(new TextEncoder().encode("echo at:$(pwd)\n"));

			await shows(`at:${alpha}`);
		});
	});

	it("starts at the size asked for, and follows a resize", async () => {
		await opened(async (port) => {
			const { socket, shows } = await terminal(port, "?cols=100&rows=30");
			socket.send(new TextEncoder().encode("stty size\n"));
			await shows("30 100");

			socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
			socket.send(new TextEncoder().encode("stty size\n"));

			await shows("40 120");
		});
	});

	it("says what job the shell runs in front when asked, null at its prompt", async () => {
		await opened(async (port) => {
			const { socket, shows, fronts } = await terminal(port);
			socket.send(new TextEncoder().encode("echo ready\n"));
			await shows("ready");

			await fronts(null);

			socket.send(new TextEncoder().encode("echo going; sleep 7\n"));
			await shows("going");

			await fronts("sleep 7");
		});
	});

	it("says how the shell exited, then closes", async () => {
		await opened(async (port) => {
			const { socket, said, closes } = await terminal(port);

			socket.send(new TextEncoder().encode("exit 3\n"));

			await closes();
			expect(said).toMatchObject({
				controls: [{ type: "exit", code: 3 }],
				closed: true,
			});
		});
	});

	it("refuses one in a task with no worktree", async () => {
		await opened(async (port) => {
			const response = await knock(port, {}, "?task=nope");

			expect(response.status).toBe(404);
		});
	});

	it("refuses one opened from another site", async () => {
		await opened(async (port) => {
			const response = await knock(port, { origin: "https://evil.example" });

			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({
				message: "a terminal opens only from its own page",
			});
		});
	});

	it("refuses one with an origin that is not one", async () => {
		await opened(async (port) => {
			const response = await knock(port, { origin: "" });

			expect(response.status).toBe(403);
		});
	});

	it("answers only to this machine, even for a host the board lets in", async () => {
		await opened(
			async (port) => {
				const response = await knock(port, {
					host: "repo.arbor.example",
					origin: "http://repo.arbor.example",
				});

				expect(response.status).toBe(403);
				expect(await response.json()).toMatchObject({
					message:
						"conversations and terminals run commands on this machine: open the page on it, or put Cloudflare Access in front with --access-team and --access-aud",
				});
			},
			{ hosts: ["repo.arbor.example"] },
		);
	});
});
