import type * as acp from "@agentclientprotocol/sdk";
import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Child, Fs, HeavyCap, Ps } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import { GUARD } from "./cloudflared-tunnel-provider";

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
 */
export class SharedBrowser implements SessionServers, AsyncResource {
	/** The MCP while it starts or runs; null before the first ask, or once it died. */
	private running: Promise<{ child: Child; url: string } | null> | null = null;

	constructor(
		private readonly deps: {
			ps: Ps;
			fs: Fs;
			timer: Timer;
			log: Logger;
			/** Held while the browser installs and its MCP starts. */
			heavy: HeavyCap;
		},
		/** Where its config is written. */
		private readonly dir: string,
	) {}

	async servers(): Promise<acp.McpServer[]> {
		this.running ??= this.start();
		const running = await this.running;
		return running === null
			? []
			: [{ type: "http", name: BROWSER_SERVER, url: running.url, headers: [] }];
	}

	async disposeAsync(): Promise<void> {
		const running = await this.running;
		this.running = null;
		if (running !== null) {
			void running.child.stdin.close().catch(() => {});
			running.child.kill();
			await running.child.exited.catch(() => 0);
		}
	}

	private async start(): Promise<{ child: Child; url: string } | null> {
		await using _slot = await this.deps.heavy.take({
			what: "shared browser start",
		});
		return this.started();
	}

	private async started(): Promise<{ child: Child; url: string } | null> {
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
				timeouts: { idle: IDLE.ms },
			}),
		);
		const command = ["bunx", PLAYWRIGHT_MCP, "--config", config, "--port", "0"];
		// Windows has no sh, so there the MCP runs bare and can outlive a crash.
		const child = ps.start(
			ps.platform === "win32" ? command : ["sh", "-c", GUARD, "sh", ...command],
		);
		const url = await this.listening(child);
		if (url === null) {
			child.kill();
			this.running = null;
			return null;
		}
		const started = this.running;
		void child.exited.then((code) => {
			if (this.running === started) {
				this.running = null;
				log.error(
					`the shared browser exited with ${code}; the next agent to start starts it again`,
				);
			}
		});
		log.info(`shared browser at ${url}`);
		return { child, url };
	}

	/** Where `child` listens, once it says, or null once it dies or `START_WAIT` passes. */
	private async listening(child: Child): Promise<string | null> {
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
		if (url === null) {
			log.error(
				`the shared browser did not start, so each agent runs its own: ${tail.trim()}`,
			);
		}
		return url;
	}
}
