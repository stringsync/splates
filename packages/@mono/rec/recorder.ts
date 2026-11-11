import type { ServerWebSocket } from "bun";
import type { Cdp } from "./cdp";
import { controlRoutes } from "./control/build";
import { ExtraLogs } from "./extra-logs";
import { LastOutcome } from "./last-outcome";
import { LiveRun } from "./live-run";
import { BrowserLogs, CONSOLE_LOG, NETWORK_LOG } from "./logs";
import { markResponse } from "./mark";
import { MicChoice } from "./mic-choice";
import { MIC_PAGE } from "./mic-page";
import { OPEN_PAGE } from "./open-page";
import { openSidePanel } from "./open-panel";
import { EVENTS_FILE, FRAMES_DIR, PointerEvents } from "./pointer";
import {
	packFrame,
	type RecorderStats,
	type ToControl,
	type ToServer,
} from "./protocol";
import type { RecorderDeps, Routes, Run } from "./run";
import { Screencast } from "./screencast";
import { Scrubber } from "./scrub";
import { type Manifest, SessionFolder } from "./session";
import { manifestSources } from "./session-sources";
import { detectSignals, MOMENTS_JSONL, renderSignals } from "./signals";

/** Past this many bytes waiting to reach the control window, a frame is dropped rather than queued. */
const BACKLOG = 8 * 1024 * 1024;

export type { RecorderDeps, Routes };

/** How long a closed control panel may take to come back before rec ends. */
export const PANEL_RECONNECT_GRACE_MS = 3000;

/**
 * The server behind the control window: it serves the window, passes it the
 * active tab's frames and writes what it records into session folders, one
 * per Start. Each Stop saves its session and leaves the window staged.
 */
export class RecorderServer {
	private readonly server: ReturnType<typeof Bun.serve>;
	private socket: ServerWebSocket<unknown> | undefined;
	private screencast: Screencast | undefined;
	private cdp: Cdp | undefined;
	private capture:
		| {
				scrubber?: Scrubber;
				docker?: string;
				tails?: string[];
				liveKey?: string;
		  }
		| undefined;
	private readonly micChoice: MicChoice | undefined;
	private staged = false;
	private noMic = false;
	private laserOn = false;
	private run: Run | undefined;
	private last: SessionFolder | undefined;
	private readonly outcome = new LastOutcome();
	private began: (started: Extract<ToServer, { type: "started" }>) => void =
		() => {};
	/** Resolves once the control window's recorder has first started. */
	readonly recording = new Promise<Extract<ToServer, { type: "started" }>>(
		(resolve) => {
			this.began = resolve;
		},
	);
	private closedWindow: () => void = () => {};
	private closeTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Resolves when the control panel has been closed for the reconnect grace
	 * (a reload or Chrome re-creating the panel reconnects within it). Mid
	 * recording, what arrived is all there will be.
	 */
	readonly closed = new Promise<void>((resolve) => {
		this.closedWindow = resolve;
	});

	/**
	 * @param dir the first session's folder, or a function that picks each
	 * session's folder as its Start arrives
	 * @param onSaved called with each session's folder once it is saved
	 */
	constructor(
		private readonly deps: RecorderDeps,
		private readonly dir: string | (() => Promise<string>),
		routes: Routes = {},
		private readonly onSaved: (
			dir: string,
			manifest: Manifest,
		) => void = () => {},
		private readonly baseName?: string,
		private readonly usedNames: ReadonlySet<string> = new Set(),
		/** The file holding the mic the person chose; without it the choice is not remembered. */
		micFile?: string,
	) {
		this.micChoice = micFile ? new MicChoice(deps.fs, micFile) : undefined;
		this.server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			development: false,
			routes: {
				...controlRoutes(),
				"/__rec/open": new Response(OPEN_PAGE, {
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
				...routes,
			},
			fetch: async (request, server) => {
				if (
					new URL(request.url).pathname === "/__rec/mark" &&
					request.method === "POST"
				) {
					return await markResponse(request, (text) => this.mark(text));
				}
				if (
					new URL(request.url).pathname === "/__rec/status" &&
					!request.headers.has("origin")
				) {
					const run = this.run;
					return Response.json({
						name: this.currentName,
						recording: this.recordingNow,
						...this.outcome.fields(),
						...(run && {
							startedAt: run.started.at,
							mic: run.started.mic === undefined ? "off" : "on",
							laser: this.laserOn,
						}),
					});
				}
				if (
					new URL(request.url).pathname === "/ws" &&
					server.upgrade(request, { data: undefined })
				) {
					return undefined;
				}
				return new Response("not found", { status: 404 });
			},
			websocket: {
				open: (socket) => {
					this.socket = socket;
					clearTimeout(this.closeTimer);
					this.say({ type: "name", name: this.currentName });
					void this.micChoice?.read().then((label) => {
						if (label !== undefined) {
							this.say({ type: "mic-choice", label });
						}
					});
				},
				message: (_socket, message) => this.receive(message),
				close: (socket) => {
					if (this.socket === socket) {
						this.socket = undefined;
						clearTimeout(this.closeTimer);
						this.closeTimer = setTimeout(
							() => this.closedWindow(),
							PANEL_RECONNECT_GRACE_MS,
						);
					}
				},
			},
		});
	}

	private sessionCount = 0;

	private get currentName(): string {
		const base = this.baseName ?? "session";
		return this.sessionCount > 1 ? `${base}-${this.sessionCount}` : base;
	}

	/** The session being recorded, else the last one. */
	get session(): SessionFolder {
		const session = this.run?.session ?? this.last;
		if (!session) {
			throw new Error("no session has started");
		}
		return session;
	}

	/** Adds an agent's remark to the recording in progress, stamped now and scrubbed. */
	mark(text: string, by: "agent" | "person" = "agent"): void {
		const run = this.run;
		if (!run?.pointer) {
			throw new Error("no recording is in progress");
		}
		const label = (this.capture?.scrubber ?? new Scrubber()).scrub(text.trim());
		if (label === "") {
			throw new Error("the remark is empty");
		}
		run.pointer.mark(this.deps.wall.now(), label, by);
	}

	/** Whether a recording is in progress. */
	get recordingNow(): boolean {
		return this.run !== undefined;
	}

	/** Where to open the control window. */
	get controlUrl(): string {
		return `http://localhost:${this.server.port}/`;
	}

	/** The page Chrome opens first: a click on it opens the side panel. */
	get openUrl(): string {
		const flags = [this.staged ? "staged" : "", this.noMic ? "nomic" : ""]
			.filter(Boolean)
			.join("&");
		return `${this.origin}/__rec/open${flags ? `?${flags}` : ""}`;
	}

	/** Where the server's other pages are, on a different site to the control window. */
	get origin(): string {
		return `http://127.0.0.1:${this.server.port}`;
	}

	/** Opens the control window and starts passing it frames from every other page. */
	async open(
		cdp: Cdp,
		options: {
			grantMic: boolean;
			/** Where the working tab goes once the side panel is open. */
			workingUrl: string;
			scrubber?: Scrubber;
			docker?: string;
			tails?: string[];
			/** Open the control window idle: nothing is captured or written until its Start button is pressed. */
			staged?: boolean;
			/** The session is narrated by remarks, not a mic: the control window opens none. */
			noMic?: boolean;
			/** OpenAI key for the live transcript shown while recording; without it nothing is shown live. */
			liveKey?: string;
			/** The most frames per second the screencast sends; the default is `DEFAULT_MAX_FPS`. */
			fps?: number;
			/** Send no frames at all, so the window browses with nothing recording it: the bench's baseline. */
			noScreencast?: boolean;
		},
	): Promise<void> {
		const origin = this.controlUrl.slice(0, -1);
		const skip = (url: string) =>
			url.startsWith(origin) || url.startsWith("chrome-extension://");
		this.cdp = cdp;
		this.capture = options;
		this.staged = options.staged ?? false;
		this.noMic = options.noMic ?? false;
		const { id } = await cdp.send<{ id: string }>("Extensions.loadUnpacked", {
			path: `${import.meta.dir}/extension`,
		});
		if (options.grantMic && !options.noMic) {
			for (const grantee of [origin, `chrome-extension://${id}`]) {
				await cdp.send("Browser.grantPermissions", {
					origin: grantee,
					permissions: ["audioCapture"],
				});
			}
		}
		if (!options.noScreencast) {
			this.screencast = await Screencast.start(
				cdp,
				this.deps.wall,
				skip,
				(frame) => {
					this.run?.pointer?.frame(frame);
					this.forward(this.deps.wall.now(), frame.jpeg);
				},
				options.fps,
			);
		}
		await openSidePanel(cdp, {
			extensionId: id,
			origin: this.origin,
			openUrl: this.openUrl,
			workingUrl: options.workingUrl,
		});
	}

	/** Starts the pointer script, the browser logs and the extra logs for a run: nothing is written before this runs. */
	private async beginCapture(run: Run): Promise<void> {
		const cdp = this.cdp;
		const options = this.capture;
		if (!cdp || !options) {
			return;
		}
		const origin = this.controlUrl.slice(0, -1);
		const scrubber = options.scrubber ?? new Scrubber();
		const dir = run.session.dir;
		const say = (message: ToControl) => this.say(message);
		const live = new LiveRun(run, say, this.deps, options.liveKey);
		run.pointer = await PointerEvents.start({
			cdp,
			fs: this.deps.fs,
			dir,
			scrubber,
			skip: (url) =>
				url.startsWith(origin) || url.startsWith("chrome-extension://"),
			onLaser: (on) => {
				this.laserOn = on;
				this.say({ type: "laser", on });
			},
			onEvent: (event) => live.event(event),
		});
		run.logs = await BrowserLogs.start({
			cdp,
			fs: this.deps.fs,
			dir,
			scrubber,
			skip: (url) =>
				url.startsWith(origin) || url.startsWith("chrome-extension://"),
			onEntry: (file, line) => live.log(file, line),
		});
		run.sources = { docker: options.docker, tails: options.tails ?? [] };
		run.extra = await ExtraLogs.start({
			ps: this.deps.ps,
			fs: this.deps.fs,
			dir,
			scrubber,
			now: () => this.deps.wall.now(),
			docker: options.docker,
			tails: run.sources.tails,
			onNote: (text) => process.stderr.write(`rec: ${text}\n`),
			onEntry: (file, line) => live.log(file, line),
		});
	}

	/** Asks the control window to stop the recording in progress, and resolves with the manifest once it is saved. */
	stop(): Promise<Manifest> {
		const run = this.run;
		if (!run) {
			return Promise.reject(new Error("no recording is in progress"));
		}
		this.say({ type: "stop" });
		return this.save(run);
	}

	/** Stops the recording in progress, if any; resolves once it is saved. */
	async interrupt(): Promise<void> {
		if (this.run) {
			await this.stop();
		}
	}

	/** Saves a run once, as soon as the control window reports it stopped. */
	private save(run: Run): Promise<Manifest> {
		run.saved ??= this.outcome.track(
			async () => {
				const stats = await run.done;
				if (this.run === run) {
					this.run = undefined;
					this.laserOn = false;
				}
				const manifest = await this.finalize(run, stats).catch((why) => {
					this.say({ type: "save-failed", message: String(why) });
					throw why;
				});
				this.last = run.session;
				this.say({ type: "saved", dir: run.session.dir });
				this.onSaved(run.session.dir, manifest);
				return manifest;
			},
			() => this.currentName,
		);
		return run.saved;
	}

	private async finalize(
		run: Run,
		stats: RecorderStats & { at: number },
	): Promise<Manifest> {
		await run.writing;
		this.release(run);
		await run.pointer?.flush();
		await run.logs?.flush();
		await run.extra?.flush();
		const { session, started } = run;
		const dir = session.dir;
		const names = (await this.deps.fs.readdir(`${dir}/logs`).catch(() => []))
			.filter((name) => name.endsWith(".log"))
			.sort();
		const logs = await Promise.all(
			names.map(async (name) => ({
				source: `logs/${name}`,
				text: await this.deps.fs.read(`${dir}/logs/${name}`),
			})),
		);
		const signals = detectSignals(
			await this.deps.fs.read(`${dir}/${EVENTS_FILE}`).catch(() => ""),
			logs,
			started.at,
		);
		await this.deps.fs.write(`${dir}/${MOMENTS_JSONL}`, renderSignals(signals));
		return await session.finish(
			{
				startedAt: started.at,
				stoppedAt: stats.at,
				micOff: started.mic === undefined ? true : undefined,
				noMic: this.noMic ? true : undefined,
				sources: manifestSources(started.mic, run.sources),
				video: {
					mimeType: started.mimeType,
					width: started.width,
					height: started.height,
				},
				stats: {
					...stats,
					received: (this.screencast?.received ?? 0) - run.receivedBefore,
					dropped: run.dropped,
				},
			},
			{
				console: CONSOLE_LOG,
				network: NETWORK_LOG,
				events: EVENTS_FILE,
				moments: MOMENTS_JSONL,
				frames: FRAMES_DIR,
				...run.extra?.files,
			},
		);
	}

	private release(run: Run): void {
		run.speech?.dispose();
		run.logs?.dispose();
		run.extra?.dispose();
		run.pointer?.dispose();
	}

	dispose(): void {
		clearTimeout(this.closeTimer);
		this.screencast?.dispose();
		if (this.run) {
			this.release(this.run);
		}
		void this.server.stop(true);
	}

	private forward(received: number, jpeg: Uint8Array): void {
		const socket = this.socket;
		if (!socket) {
			return;
		}
		if (socket.getBufferedAmount() > BACKLOG) {
			if (this.run) {
				this.run.dropped++;
			}
			return;
		}
		socket.sendBinary(packFrame(received, jpeg));
	}

	private async openMicSettings(): Promise<void> {
		const url = new URL(MIC_PAGE, this.controlUrl).href;
		await this.cdp?.send("Target.createTarget", { url }).catch(() => {});
		this.say({ type: "mic-settings" });
	}

	private say(message: ToControl): void {
		this.socket?.send(JSON.stringify(message));
	}

	private receive(message: string | Buffer): void {
		const run = this.run;
		if (typeof message !== "string") {
			if (run) {
				const chunk = new Uint8Array(message);
				run.writing = run.writing.then(() => run.session.append(chunk));
			}
			return;
		}
		const said = JSON.parse(message) as ToServer;
		switch (said.type) {
			case "started": {
				if (this.run) {
					return;
				}
				let finished: Run["finished"] = () => {};
				let failed: Run["failed"] = () => {};
				const done = new Promise<RecorderStats & { at: number }>(
					(resolve, reject) => {
						finished = resolve;
						failed = reject;
					},
				);
				// A failure nobody awaits yet must not crash rec.
				done.catch(() => {});
				const fresh: Run = {
					started: said,
					writing: Promise.resolve(),
					session: undefined as unknown as SessionFolder,
					sources: { tails: [] },
					dropped: 0,
					receivedBefore: this.screencast?.received ?? 0,
					finished,
					failed,
					done,
				};
				do {
					this.sessionCount++;
				} while (this.usedNames.has(this.currentName));
				this.say({ type: "name", name: this.currentName });
				this.run = fresh;
				this.began(said);
				fresh.writing = (async () => {
					const dir =
						typeof this.dir === "string" ? this.dir : await this.dir();
					fresh.session = new SessionFolder(
						this.deps.fs,
						dir,
						this.currentName,
					);
					await fresh.session.begin(said.mimeType);
					await this.beginCapture(fresh);
				})();
				// Save as soon as the window says it stopped, with or without rec asking.
				void this.save(fresh).catch((error: unknown) =>
					this.deps.log.error(
						`could not save the session: ${(error as Error).message}`,
					),
				);
				void fresh.writing.then(() =>
					this.deps.log.info(
						`recording ${said.width}x${said.height} ${said.mimeType} into ${fresh.session.dir}`,
					),
				);
				return;
			}
			case "stopped":
				run?.finished({ ...said.stats, at: said.at });
				return;
			case "remark":
				try {
					this.mark(said.text, "person");
				} catch {
					// Nothing is recording, or the text was empty: there is nothing to keep.
				}
				return;
			case "audio":
				run?.speech?.audio(said.pcm);
				return;
			case "mic-choice":
				void this.micChoice
					?.write(said.label)
					.catch((error: unknown) =>
						this.deps.log.error(
							`could not remember the mic: ${(error as Error).message}`,
						),
					);
				return;
			case "open-mic-settings":
				void this.openMicSettings();
				return;
			case "failed": {
				const error = new Error(`the control window failed: ${said.message}`);
				if (run) {
					run.failed(error);
				} else {
					this.deps.log.error(error.message);
				}
				return;
			}
		}
	}
}
