import { Disposer, type Resource } from "core/disposable";
import { Duration, sleep, type WallClock } from "core/time";
import type { Cdp, CdpEvent } from "./cdp";
import type { PageFilter } from "./sinks";

/** One painted frame of a tab, as Chrome's screencast sends it. */
export interface Frame {
	/** JPEG bytes. */
	jpeg: Uint8Array;
	/** When the tab painted it, in wall-clock ms. */
	at: number;
	targetId: string;
}

interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** Frames per second the screencast sends at most; a high-refresh display paints far more than a recording needs. */
export const DEFAULT_MAX_FPS = 30;

/** Gets each frame the screencast sends. */
export interface FrameSink {
	frame(frame: Frame): void;
}

export interface ScreencastOptions {
	/** Pages whose frames are not sent, by url. */
	skip: PageFilter;
	frames: FrameSink;
	/** The most frames a second; defaults to `DEFAULT_MAX_FPS`. */
	maxFps?: number;
}

/**
 * Streams frames of every page that is not the control window to `frames`,
 * at most `maxFps` a second. Only the active tab paints, so only its frames arrive.
 */
export class Screencast implements Resource {
	private readonly disposer = new Disposer();
	/** Each attached page's session, by its target. */
	private readonly sessions = new Map<string, string>();
	private readonly targets = new Map<string, string>();
	/** When each page's latest frame is due its acknowledgement, in wall-clock ms, by its session. */
	private readonly acked = new Map<string, number>();
	received = 0;

	private constructor(
		private readonly cdp: Cdp,
		private readonly wall: WallClock,
		private readonly skip: PageFilter,
		private readonly frames: FrameSink,
		private readonly maxFps: number,
	) {
		this.disposer.use(cdp.on(this.receive));
	}

	static async start(
		cdp: Cdp,
		wall: WallClock,
		opts: ScreencastOptions,
	): Promise<Screencast> {
		const { skip, frames, maxFps = DEFAULT_MAX_FPS } = opts;
		const cast = new Screencast(cdp, wall, skip, frames, maxFps);
		await cdp.send("Target.setDiscoverTargets", { discover: true });
		const { targetInfos } = await cdp.send<{ targetInfos: TargetInfo[] }>(
			"Target.getTargets",
		);
		await Promise.all(targetInfos.map((info) => cast.attach(info)));
		return cast;
	}

	dispose(): void {
		this.disposer.dispose();
		for (const sessionId of this.sessions.values()) {
			void this.cdp
				.send("Page.stopScreencast", {}, sessionId)
				.catch(() => undefined);
		}
		this.sessions.clear();
	}

	private async attach(info: TargetInfo): Promise<void> {
		if (
			info.type !== "page" ||
			this.sessions.has(info.targetId) ||
			this.skip.skips(info.url)
		) {
			return;
		}
		// Held before the await, so a second event for the target does not attach twice.
		this.sessions.set(info.targetId, "");
		try {
			const { sessionId } = await this.cdp.send<{ sessionId: string }>(
				"Target.attachToTarget",
				{ targetId: info.targetId, flatten: true },
			);
			this.sessions.set(info.targetId, sessionId);
			this.targets.set(sessionId, info.targetId);
			await this.cdp.send("Page.enable", {}, sessionId);
			await this.cdp.send(
				"Page.startScreencast",
				{ format: "jpeg", quality: 80, maxWidth: 1920, maxHeight: 1080 },
				sessionId,
			);
		} catch {
			// The tab closed while it was being attached.
			this.sessions.delete(info.targetId);
		}
	}

	private readonly receive = (event: CdpEvent): void => {
		switch (event.method) {
			case "Target.targetCreated":
			case "Target.targetInfoChanged":
				void this.attach(event.params.targetInfo as TargetInfo);
				return;
			case "Target.detachedFromTarget": {
				const targetId = this.targets.get(String(event.params.sessionId));
				if (targetId) {
					this.sessions.delete(targetId);
				}
				return;
			}
			case "Page.screencastFrame":
				this.frame(event);
				return;
		}
	};

	private frame(event: CdpEvent): void {
		const params = event.params as {
			data: string;
			sessionId: number;
			metadata: { timestamp?: number };
		};
		void this.acknowledge(params.sessionId, event.sessionId);
		this.received++;
		const seconds = params.metadata.timestamp;
		this.frames.frame({
			jpeg: Uint8Array.fromBase64(params.data),
			at: seconds === undefined ? this.wall.now() : seconds * 1000,
			targetId: this.targets.get(event.sessionId ?? "") ?? "",
		});
	}

	/**
	 * Chrome sends the next frame only once this one is acknowledged, so
	 * holding the acknowledgement back to the frame rate cap makes Chrome
	 * encode fewer frames, not just the server pass fewer on.
	 */
	private async acknowledge(
		frameSession: number,
		pageSession: string | undefined,
	): Promise<void> {
		const key = pageSession ?? "";
		const now = this.wall.now();
		// Taken before waiting, so frames in flight together queue behind each other.
		const at = Math.max(now, (this.acked.get(key) ?? 0) + 1000 / this.maxFps);
		this.acked.set(key, at);
		if (at > now) {
			await sleep(Duration.ms(at - now));
		}
		await this.cdp
			.send("Page.screencastFrameAck", { sessionId: frameSession }, pageSession)
			.catch(() => undefined);
	}
}
