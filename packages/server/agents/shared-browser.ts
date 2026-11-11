import type * as acp from "@agentclientprotocol/sdk";
import type { AsyncResource } from "core/disposable";
import { color, type Logger } from "core/log";
import type { Child, Fs, Ps } from "core/system";
import { Duration, type Timer } from "core/time";
import { GUARD } from "../tunnel";

/** Pinned, so the browser it installs is the one it launches. */
export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83";

/**
 * The name sessions are offered it by, which an agent's own server of that
 * name gives way to, so its tools keep the names they had.
 */
export const BROWSER_SERVER = "playwright";

/** How long the browser stays up with no tool call from any session. */
export const IDLE = Duration.mins(5);

/** How long the MCP has to say where it listens, a first install aside. */
const START_WAIT = Duration.secs(30);

/** What the MCP prints once it listens, with where; it answers MCP at `/mcp` there. */
const LISTENING = /Listening on (http:\/\/\S+)/;

/** How much of the MCP's output is kept to explain how it died. */
const OUTPUT_CHARS = 2_000;

/** How long the remembered proxy port is retried when taken, such as by a splates still shutting down. */
const PORT_WAIT = Duration.secs(10);

/** How often the remembered proxy port is retried. */
const PORT_RETRY = Duration.ms(500);

/**
 * The MCP servers each agent session is offered, beyond its own.
 */
export interface SessionServers {
	servers(): Promise<acp.McpServer[]>;
}

/**
 * One headless browser for every agent session on the machine: a Playwright
 * MCP over HTTP, started on the first session that asks, giving each session
 * a browser context of its own in one chrome-headless-shell, in place of a
 * full Chrome and an MCP per session. One that cannot start, or dies, is
 * logged and offered to no session, which then runs its agent's own.
 *
 * Sessions are offered a small proxy on a port kept across restarts, not the
 * MCP itself. A connection it takes starts the MCP again when it is gone, so
 * a session that began before the browser stopped (idle, crashed, splates
 * restarted) reconnects to the same URL and finds it up.
 */
export class SharedBrowser implements SessionServers, AsyncResource {
	/** The MCP while it starts or runs; null before the first ask, or once it died. */
	private running: Promise<{ child: Child; url: string } | null> | null = null;

	/** The proxy sessions connect to, once listening. */
	private proxy: { port: number; stop(): void } | null = null;

	constructor(
		private readonly deps: {
			ps: Ps;
			fs: Fs;
			timer: Timer;
			log: Logger;
		},
		/** Where its config is written. */
		private readonly dir: string,
	) {}

	async servers(): Promise<acp.McpServer[]> {
		const running = await this.ensure();
		if (running === null) {
			return [];
		}
		this.proxy ??= await this.listen();
		const url =
			this.proxy === null
				? running.url
				: `http://127.0.0.1:${this.proxy.port}/mcp`;
		return [{ type: "http", name: BROWSER_SERVER, url, headers: [] }];
	}

	async disposeAsync(): Promise<void> {
		this.proxy?.stop();
		this.proxy = null;
		const running = await this.running;
		this.running = null;
		if (running !== null) {
			void running.child.stdin.close().catch(() => {});
			running.child.kill();
			await running.child.exited.catch(() => 0);
		}
	}

	/** The MCP, started when it is not up; concurrent callers share one start. */
	private ensure(): Promise<{ child: Child; url: string } | null> {
		this.running ??= this.start();
		return this.running;
	}

	/**
	 * Listens on the port the last proxy did (any free one when it is taken),
	 * passing each connection to the MCP, which it starts first when down.
	 * Null when no port can be bound, so sessions get the MCP's own URL.
	 */
	private async listen(): Promise<{ port: number; stop(): void } | null> {
		const { fs, log } = this.deps;
		const portFile = `${this.dir}/playwright-proxy.port`;
		const remembered = await this.remembered(portFile);
		type Link = {
			upstream: Bun.Socket<unknown> | null;
			queued: Uint8Array[];
			closed: boolean;
		};
		const handlers: Bun.SocketHandler<Link> = {
			open: (client) => {
				client.data = { upstream: null, queued: [], closed: false };
				this.ensure()
					.then(async (running) => {
						if (running === null) {
							client.end();
							return;
						}
						const { hostname, port } = new URL(running.url);
						const upstream = await Bun.connect({
							hostname,
							port: Number(port),
							socket: {
								data: (_up, chunk) => void client.write(chunk),
								close: () => void client.end(),
								error: () => void client.end(),
							},
						});
						client.data.upstream = upstream;
						for (const chunk of client.data.queued) {
							upstream.write(chunk);
						}
						client.data.queued = [];
						if (client.data.closed) {
							upstream.end();
						}
					})
					.catch(() => client.end());
			},
			data: (client, chunk) => {
				if (client.data.upstream === null) {
					client.data.queued.push(new Uint8Array(chunk));
				} else {
					client.data.upstream.write(chunk);
				}
			},
			close: (client) => {
				client.data.closed = true;
				client.data.upstream?.end();
			},
			error: (client) => {
				client.data.closed = true;
				client.data.upstream?.end();
			},
		};
		const bind = (port: number) => {
			try {
				return Bun.listen<Link>({
					hostname: "127.0.0.1",
					port,
					socket: handlers,
				});
			} catch {
				return null;
			}
		};
		let server = remembered === null ? null : bind(remembered);
		for (
			let waited = 0;
			server === null && remembered !== null && waited < PORT_WAIT.ms;
			waited += PORT_RETRY.ms
		) {
			await new Promise<void>((resolve) => {
				this.deps.timer.setTimeout(resolve, PORT_RETRY);
			});
			server = bind(remembered);
		}
		server ??= bind(0);
		if (server === null) {
			log.error(
				"the shared browser proxy could not listen, so sessions keep the browser's own URL, which dies with it",
			);
			return null;
		}
		if (remembered !== null && remembered !== server.port) {
			log.info(
				`the shared browser proxy moved from port ${remembered} to ${server.port}; sessions started before keep the old URL`,
			);
		}
		await fs.write(portFile, String(server.port)).catch(() => {});
		return { port: server.port, stop: () => void server.stop(true) };
	}

	private async start(): Promise<{ child: Child; url: string } | null> {
		const { ps, fs, log } = this.deps;
		const installed = await ps.spawnCapture([
			"bunx",
			PLAYWRIGHT_MCP,
			"install-browser",
			"chromium-headless-shell",
		]);
		if (installed.exitCode !== 0) {
			log.error(
				`the shared browser did not install, so each agent runs its own: ${installed.stderr.trim() || installed.stdout.trim()}`,
			);
			this.running = null;
			return null;
		}
		const config = `${this.dir}/playwright-mcp.json`;
		await fs.write(
			config,
			JSON.stringify({
				// Chromium with no channel runs headless as the headless shell;
				// any channel, or none named, runs a full Chrome.
				browser: {
					browserName: "chromium",
					isolated: true,
					launchOptions: { headless: true },
				},
				// Agents save screenshots under /tmp and open file: URLs, which
				// the default guard refuses outside the working directory.
				allowUnrestrictedFileAccess: true,
				timeouts: { idle: IDLE.ms },
			}),
		);
		const launched = await this.launch(0, config);
		if (launched === null) {
			this.running = null;
			return null;
		}
		const { child, url } = launched;
		const started = this.running;
		void child.exited.then((code) => {
			if (this.running === started) {
				this.running = null;
				log.error(
					`the shared browser exited with ${code}; the next connection starts it again`,
				);
			}
		});
		log.info(`${color.green("started")} shared browser at ${url}`);
		return { child, url };
	}

	/** The port the last browser listened on, or null when none is kept. */
	private async remembered(file: string): Promise<number | null> {
		const { fs } = this.deps;
		const text = await fs.read(file).catch(() => "");
		const port = Number(text.trim());
		return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
	}

	/** The MCP on `port` (0 for any free one), once it says where it listens, or null. */
	private async launch(
		port: number,
		config: string,
	): Promise<{ child: Child; url: string } | null> {
		const { ps } = this.deps;
		const command = [
			"bunx",
			PLAYWRIGHT_MCP,
			"--config",
			config,
			"--port",
			String(port),
			// Sessions arrive through the proxy as 127.0.0.1:<its port>, which
			// the MCP refuses with a 403 unless its host check is off, and an
			// agent reports a refused server as needing authorization.
			"--allowed-hosts",
			"*",
		];
		// Windows has no sh, so there the MCP runs bare and can outlive a crash.
		const child = ps.start(
			ps.platform === "win32" ? command : ["sh", "-c", GUARD, "sh", ...command],
		);
		const url = await this.listening(child, port !== 0);
		if (url === null) {
			child.kill();
			return null;
		}
		return { child, url };
	}

	/** Where `child` listens, once it says, or null once it dies or `START_WAIT` passes; `quiet` leaves that unlogged. */
	private async listening(
		child: Child,
		quiet: boolean,
	): Promise<string | null> {
		const { timer, log } = this.deps;
		let tail = "";
		let found: (url: string) => void = () => {};
		const said = new Promise<string>((resolve) => {
			found = resolve;
		});
		// Read to the end, though the address comes first, so a full pipe
		// never stalls the MCP.
		const read = async (stream: ReadableStream<Uint8Array>) => {
			const decoder = new TextDecoder();
			for await (const chunk of stream) {
				tail = (tail + decoder.decode(chunk)).slice(-OUTPUT_CHARS);
				const listens = LISTENING.exec(tail)?.[1];
				if (listens !== undefined) {
					found(`${listens}/mcp`);
				}
			}
		};
		void read(child.stdout).catch(() => {});
		void read(child.stderr).catch(() => {});
		let giveUp: { dispose(): void } | undefined;
		const url = await Promise.race([
			said,
			child.exited.then(
				() => null,
				() => null,
			),
			new Promise<null>((resolve) => {
				giveUp = timer.setTimeout(() => resolve(null), START_WAIT);
			}),
		]);
		giveUp?.dispose();
		if (url === null && !quiet) {
			log.error(
				`the shared browser did not start, so each agent runs its own: ${tail.trim()}`,
			);
		}
		return url;
	}
}
