import type { Manifest } from "./session";

/** One stream's packets in the recording file, as ffprobe lists them. */
export interface StreamPackets {
	kind: "video" | "audio";
	count: number;
	/** First and last presentation times, in seconds. */
	first: number;
	last: number;
}

/**
 * Counts each stream's packets and their span from ffprobe's csv output,
 * given the stream list and the packet list.
 */
export function parsePackets(
	streams: string,
	packets: string,
): StreamPackets[] {
	const kinds = new Map<string, "video" | "audio">();
	for (const line of streams.trim().split("\n")) {
		const [index, kind] = line.split(",");
		if (index !== undefined && (kind === "video" || kind === "audio")) {
			kinds.set(index, kind);
		}
	}
	const found = new Map<string, StreamPackets>();
	for (const line of packets.trim().split("\n")) {
		const [index, pts] = line.split(",");
		const kind = kinds.get(index ?? "");
		const time = Number(pts);
		if (!kind || pts === undefined || pts === "" || Number.isNaN(time)) {
			continue;
		}
		const stream = found.get(kind);
		if (stream) {
			stream.count++;
			stream.first = Math.min(stream.first, time);
			stream.last = Math.max(stream.last, time);
		} else {
			found.set(kind, { kind, count: 1, first: time, last: time });
		}
	}
	return [...found.values()];
}

/** CPU time each process has used so far, by Chrome's `SystemInfo.getProcessInfo`. */
export interface ProcessCpu {
	id: number;
	type: string;
	cpuTime: number;
}

export interface CpuSample {
	/** When it was taken, in wall-clock ms. */
	at: number;
	processes: ProcessCpu[];
	/** The control window's main-thread busy time so far, in seconds, from `Performance.getMetrics`. */
	controlTask: number;
}

export interface BenchReport {
	wallSecs: number;
	frames: {
		/** Frames Chrome's screencast sent the server. */
		received: number;
		receivedFps: number;
		/** Dropped by the server because the window fell behind. */
		droppedAtServer: number;
		/** Dropped by the window because a newer frame arrived first. */
		superseded: number;
		painted: number;
		paintedFps: number;
		/** Redraws of the last frame while the tab painted nothing. */
		repeats: number;
	};
	file: {
		videoFrames: number;
		videoFps: number;
		videoSecs: number;
		audioSecs: number;
		/** Video's last frame minus audio's last packet: positive means video runs long. */
		avDriftMs: number;
		/** The video's length minus the wall time the recorder ran. */
		videoVsWallMs: number;
		megabytesPerMinute: number;
	};
	/** From the server receiving a frame to the canvas drawing it, in ms. */
	latency: { p50: number; p95: number; max: number };
	cpu: {
		/** Share of one core the control window's main thread was busy. */
		controlMainThreadPct: number;
		/** Share of one core each kind of Chrome process used, summed over processes of that kind. */
		byProcessType: Record<string, number>;
	};
}

const round = (value: number, places = 1) =>
	Math.round(value * 10 ** places) / 10 ** places;

/** The CPU part of a report, alone: a baseline run records nothing, so it has no frames or file. */
export function summarizeCpu(
	before: CpuSample,
	after: CpuSample,
): { wallSecs: number; cpu: BenchReport["cpu"] } {
	const cpuSecs = (after.at - before.at) / 1000;
	const byProcessType: Record<string, number> = {};
	for (const process of after.processes) {
		const earlier = before.processes.find(
			(earlier) => earlier.id === process.id,
		);
		const used = process.cpuTime - (earlier?.cpuTime ?? 0);
		byProcessType[process.type] =
			(byProcessType[process.type] ?? 0) + (used / cpuSecs) * 100;
	}
	for (const type of Object.keys(byProcessType)) {
		byProcessType[type] = round(byProcessType[type] ?? 0);
	}
	return {
		wallSecs: round(cpuSecs),
		cpu: {
			controlMainThreadPct: round(
				((after.controlTask - before.controlTask) / cpuSecs) * 100,
			),
			byProcessType,
		},
	};
}

export function summarize(
	manifest: Manifest,
	streams: StreamPackets[],
	bytes: number,
	before: CpuSample,
	after: CpuSample,
): BenchReport {
	const wallSecs = (manifest.stoppedAt - manifest.startedAt) / 1000;
	const video = streams.find((stream) => stream.kind === "video");
	const audio = streams.find((stream) => stream.kind === "audio");
	const videoSecs = video ? video.last - video.first : 0;
	const audioSecs = audio ? audio.last - audio.first : 0;
	const { stats } = manifest;
	return {
		wallSecs: round(wallSecs),
		frames: {
			received: stats.received,
			receivedFps: round(stats.received / wallSecs),
			droppedAtServer: stats.dropped,
			superseded: stats.superseded,
			painted: stats.painted,
			paintedFps: round(stats.painted / wallSecs),
			repeats: stats.repeats,
		},
		file: {
			videoFrames: video?.count ?? 0,
			videoFps: round(videoSecs > 0 ? (video?.count ?? 0) / videoSecs : 0),
			videoSecs: round(videoSecs, 2),
			audioSecs: round(audioSecs, 2),
			avDriftMs: Math.round(((video?.last ?? 0) - (audio?.last ?? 0)) * 1000),
			videoVsWallMs: Math.round((videoSecs - wallSecs) * 1000),
			megabytesPerMinute: round(bytes / 1e6 / (wallSecs / 60), 2),
		},
		latency: stats.latency,
		cpu: summarizeCpu(before, after).cpu,
	};
}

/**
 * The working tab the bench records: a CSS animation, a canvas animation and
 * a looping video held in view, beside a long column the bench scrolls.
 */
export const BENCH_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>rec bench</title>
<style>
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; display: flex; }
#side { position: sticky; top: 0; height: 100vh; width: 560px; flex: none; background: #111; color: #eee; padding: 16px; box-sizing: border-box; }
video { width: 100%; display: block; }
.spin { display: inline-block; width: 60px; height: 60px; margin: 12px 8px; background: linear-gradient(45deg, #e33, #33e); animation: spin 1.2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
#clock { font: 28px ui-monospace, monospace; }
main { flex: 1; padding: 0 24px; }
.row { padding: 12px; border-bottom: 1px solid #ddd; }
.row:nth-child(3n) { background: #f4f4ff; }
</style></head><body>
<div id="side">
<video src="/bench/video.mp4" autoplay muted loop playsinline></video>
<div><span class="spin"></span><span class="spin"></span><span class="spin"></span></div>
<canvas id="wave" width="528" height="120"></canvas>
<div id="clock"></div>
</div>
<main id="rows"></main>
<script>
const rows = document.getElementById("rows");
for (let i = 0; i < 2000; i++) {
	const row = document.createElement("div");
	row.className = "row";
	row.textContent = "Row " + i + ": the bench scrolls this column up and down while the video and animations play.";
	rows.append(row);
}
const wave = document.getElementById("wave").getContext("2d");
const clock = document.getElementById("clock");
function frame(now) {
	wave.fillStyle = "#111";
	wave.fillRect(0, 0, 528, 120);
	wave.strokeStyle = "#4c4";
	wave.beginPath();
	for (let x = 0; x < 528; x += 4) {
		wave.lineTo(x, 60 + 50 * Math.sin(x / 30 + now / 200));
	}
	wave.stroke();
	clock.textContent = new Date().toISOString().slice(11, 23);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
