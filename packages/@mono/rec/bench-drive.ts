import { Duration, sleep, type WallClock } from "core/time";
import type { CpuSample, ProcessCpu } from "./bench";
import { parsePackets } from "./bench";
import type { Cdp } from "./cdp";
import type { RecDeps } from "./rec";

/** The bytes of the video the bench's page plays; call it once per bench. */
export async function benchVideo(
	deps: RecDeps,
	home: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const path = `${home}/bench/video.mp4`;
	if (!(await deps.fs.exists(path))) {
		await deps.fs.mkdir(`${home}/bench`, { recursive: true });
		const made = await deps.ps.spawnCapture([
			"ffmpeg",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=1280x720:rate=30",
			"-t",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-c:v",
			"libx264",
			"-y",
			path,
		]);
		if (made.exitCode !== 0) {
			throw new Error(`ffmpeg could not make the bench video: ${made.stderr}`);
		}
	}
	return new Uint8Array(await deps.fs.readBytes(path));
}

/** Drives the bench's Chrome over the DevTools protocol: finds its targets, samples CPU and scrolls the working tab. */
export class BenchDriver {
	constructor(private readonly cdp: Cdp) {}

	async attach(
		type: "page" | "iframe",
		matches: (url: string) => boolean,
	): Promise<string> {
		// The target may still be opening, as when nothing waits for a recording to start.
		const deadline = performance.now() + 10_000;
		let target: { targetId: string } | undefined;
		while (!target) {
			const { targetInfos } = await this.cdp.send<{
				targetInfos: { targetId: string; type: string; url: string }[];
			}>("Target.getTargets");
			target = targetInfos.find(
				(info) => info.type === type && matches(info.url),
			);
			if (!target) {
				if (performance.now() > deadline) {
					throw new Error(
						`the bench could not find its ${type} target among ${targetInfos.map((info) => `${info.type} ${info.url}`).join(", ")}`,
					);
				}
				await sleep(Duration.ms(250));
			}
		}
		const { sessionId } = await this.cdp.send<{ sessionId: string }>(
			"Target.attachToTarget",
			{ targetId: target.targetId, flatten: true },
		);
		return sessionId;
	}

	async sampleCpu(controlWindow: string, wall: WallClock): Promise<CpuSample> {
		const [{ processInfo }, { metrics }] = await Promise.all([
			this.cdp.send<{ processInfo: ProcessCpu[] }>("SystemInfo.getProcessInfo"),
			this.cdp.send<{ metrics: { name: string; value: number }[] }>(
				"Performance.getMetrics",
				{},
				controlWindow,
			),
		]);
		return {
			at: wall.now(),
			processes: processInfo,
			controlTask:
				metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0,
		};
	}

	/** Scrolls the working tab for `length`, down then up in bursts with rests between. */
	async scroll(working: string, length: Duration): Promise<void> {
		const end = performance.now() + length.ms;
		let down = true;
		while (performance.now() < end) {
			const burstEnd = Math.min(end, performance.now() + 4000);
			while (performance.now() < burstEnd) {
				await this.cdp.send(
					"Input.dispatchMouseEvent",
					{
						type: "mouseWheel",
						x: 900,
						y: 400,
						deltaX: 0,
						deltaY: down ? 120 : -120,
					},
					working,
				);
				await sleep(Duration.ms(50));
			}
			down = !down;
			await sleep(
				Duration.ms(Math.max(0, Math.min(4000, end - performance.now()))),
			);
		}
	}
}

export async function probe(deps: RecDeps, file: string) {
	const run = async (entries: string) => {
		const result = await deps.ps.spawnCapture([
			"ffprobe",
			"-v",
			"error",
			"-show_entries",
			entries,
			"-of",
			"csv=p=0",
			file,
		]);
		if (result.exitCode !== 0) {
			throw new Error(`ffprobe could not read ${file}: ${result.stderr}`);
		}
		return result.stdout;
	};
	return parsePackets(
		await run("stream=index,codec_type"),
		await run("packet=stream_index,pts_time"),
	);
}
