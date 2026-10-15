import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { dev } from "./dev";
import { serving } from "./dev-testing";
import { Testing } from "./testing";

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

	/** A terminal open on `query`, with everything it has said so far. */
	const terminal = async (port: number, query = "") => {
		// As a page would: Bun's client sends no Origin of its own. The DOM's
		// type for the constructor does not know Bun takes options here.
		const options: Bun.WebSocketOptions = {
			headers: { origin: `http://127.0.0.1:${port}` },
		};
		const socket = new WebSocket(
			`ws://127.0.0.1:${port}/api/terminal${query}`,
			options as string[],
		);
		socket.binaryType = "arraybuffer";
		const said = { screen: "", controls: [] as unknown[], closed: false };
		const decoder = new TextDecoder();
		socket.addEventListener("message", ({ data }) => {
			if (typeof data === "string") {
				said.controls.push(JSON.parse(data));
			} else {
				said.screen += decoder.decode(data as ArrayBuffer, { stream: true });
			}
		});
		socket.addEventListener("close", () => {
			said.closed = true;
		});
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve);
			socket.addEventListener("error", reject);
		});
		/** Waits for the shell to have written `text`, up to a few seconds. */
		const shows = async (text: string) => {
			for (let i = 0; i < 300 && !said.screen.includes(text); i++) {
				await Bun.sleep(10);
			}
			expect(said.screen).toContain(text);
		};
		/**
		 * Asks what job the shell runs in front until it answers `command`, up
		 * to a few seconds, since a job takes a moment to come to the front.
		 */
		const fronts = async (command: string | null) => {
			let answer: unknown;
			for (let i = 0; i < 100 && answer !== command; i++) {
				const before = said.controls.length;
				socket.send(JSON.stringify({ type: "front" }));
				for (let j = 0; j < 300 && said.controls.length === before; j++) {
					await Bun.sleep(10);
				}
				answer = (said.controls.at(-1) as { command?: unknown }).command;
			}
			expect(said.controls.at(-1)).toEqual({ type: "front", command });
		};
		/** Waits for the server to hang up, up to a few seconds. */
		const closes = async () => {
			for (let i = 0; i < 300 && !said.closed; i++) {
				await Bun.sleep(10);
			}
		};
		return { socket, said, shows, fronts, closes };
	};

	const opened = async (
		body: (port: number) => Promise<void>,
		options: { hosts?: string[] } = {},
	) => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			shell: ["/bin/sh"],
			...options,
		});
		try {
			await body(server.port);
		} finally {
			await server.disposeAsync();
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
