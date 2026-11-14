import type { ServerWebSocket } from "bun";
import { Dispatcher, type Events } from "core/events";
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
	UNKNOWN_STATS,
} from "./protocol";
import type { OpenOptions, RecorderServerOptions } from "./recorder-options";
import type { RecorderDeps, Routes, Run } from "./run";
import { Screencast } from "./screencast";
import { Scrubber } from "./scrub";
import { type Manifest, SessionFolder } from "./session";
import { manifestSources } from "./session-sources";
import { MOMENTS_JSONL } from "./signals";
import { OtherPages, type RecorderEvents, type SessionDirs } from "./sinks";
import { writeSignals } from "./write-signals";

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
	private readonly dispatcher = new Dispatcher<RecorderEvents>();
	/** Raised with each session's folder once it is saved. */
	readonly events: Events<RecorderEvents> = this.dispatcher.events;
	private readonly baseName: string | undefined;
	private readonly usedNames: ReadonlySet<string>;
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
	/** Resolves once the control panel has stayed closed past the reconnect grace, so rec can end. */
	readonly closed = new Promise<void>((resolve) => {
		this.closedWindow = resolve;
	});

	/**
	 * @param dir the first session's folder, or the dirs that pick each
	 * session's folder as its Start arrives
	 * @param opts what the server is configured with, last
	 */
	constructor(
		private readonly deps: RecorderDeps,
		private readonly dir: string | SessionDirs,
		opts: RecorderServerOptions = {},
	) {
		const { routes = {}, micFile, processing = () => [] } = opts;
		this.baseName = opts.baseName;
		this.usedNames = opts.usedNames ?? new Set();
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
					return await markResponse(request, this);
				}
				if (
					new URL(request.url).pathname === "/__rec/status" &&
					!request.headers.has("origin")
				) {
					const run = this.run;
					const finishing = processing();
					return Response.json({
						name: this.currentName,
						recording: this.recordingNow,
						...this.outcome.fields(),
						...(finishing.length > 0 && { processing: finishing }),
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
	async open(cdp: Cdp, opts: OpenOptions): Promise<void> {
		const origin = this.controlUrl.slice(0, -1);
		const skip = new OtherPages(origin);
		this.cdp = cdp;
		this.capture = opts;
		this.staged = opts.staged ?? false;
		this.noMic = opts.noMic ?? false;
		const { id } = await cdp.send<{ id: string }>("Extensions.loadUnpacked", {
			path: `${import.meta.dir}/extension`,
		});
		if (opts.grantMic && !opts.noMic) {
			for (const grantee of [origin, `chrome-extension://${id}`]) {
				await cdp.send("Browser.grantPermissions", {
					origin: grantee,
					permissions: ["audioCapture"],
				});
			}
		}
		if (!opts.noScreencast) {
			this.screencast = await Screencast.start(cdp, this.deps.wall, {
				skip,
				frames: {
					frame: (frame) => {
						this.run?.pointer?.frame(frame);
						this.forward(this.deps.wall.now(), frame.jpeg);
					},
				},
				maxFps: opts.fps,
			});
		}
		await openSidePanel(cdp, {
			extensionId: id,
			origin: this.origin,
			openUrl: this.openUrl,
			workingUrl: opts.workingUrl,
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
		const live = new LiveRun({
			run,
			say,
			deps: this.deps,
			liveKey: options.liveKey,
		});
		run.pointer = await PointerEvents.start({
			cdp,
			fs: this.deps.fs,
			dir,
			scrubber,
			skip: new OtherPages(origin),
			observer: {
				laser: (on) => {
					this.laserOn = on;
					this.say({ type: "laser", on });
				},
				event: (event) => live.event(event),
			},
		});
		run.logs = await BrowserLogs.start({
			cdp,
			fs: this.deps.fs,
			dir,
			scrubber,
			skip: new OtherPages(origin),
			entries: live,
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
			notes: { note: (text) => process.stderr.write(`rec: ${text}\n`) },
			entries: live,
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

	/** Saves the recording in progress when Chrome closed before it could stop; what arrived is kept. */
	async salvage(): Promise<void> {
		const run = this.run;
		if (run) {
			run.finished({ ...UNKNOWN_STATS, at: this.deps.wall.now() });
			await this.save(run);
		}
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
				this.dispatcher.dispatch("saved", { dir: run.session.dir, manifest });
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
		await writeSignals(this.deps.fs, dir, started.at);
		return await session.finish(
			{
				startedAt: started.at,
				stoppedAt: stats.at,
				processing: { status: "pending" },
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
						typeof this.dir === "string" ? this.dir : await this.dir.next();
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
