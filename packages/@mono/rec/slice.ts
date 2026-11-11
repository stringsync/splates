import type { Fs, Ps } from "core/system";
import { parseMomentsFile } from "./moments-files";
import type { Manifest } from "./session";
import { MOMENTS_JSONL } from "./signals";

export const DEFAULT_PADDING = 5;
export const MAX_SHOTS = 12;

export interface SliceResult {
	folder: string;
	/** Video seconds the clip covers. */
	from: number;
	to: number;
	/** The exact moment, in video seconds. */
	at: number;
	clip: string;
	shots: string[];
}

/** Parses `90`, `1:23` or `1:02:03` into seconds. */
export function parseVideoTime(text: string): number {
	const parts = text.split(":").map(Number);
	if (
		parts.length > 3 ||
		parts.length === 0 ||
		parts.some((part) => !Number.isFinite(part) || part < 0)
	) {
		throw new Error(`Not a video time: ${text} (use seconds or m:ss)`);
	}
	return parts.reduce((sum, part) => sum * 60 + part, 0);
}

export interface PlanOptions {
	at: number;
	before: number;
	after: number;
	length: number;
}

/** The window around `at`, clamped to the recording, and the seconds to take a still at. */
export function planSlice(opts: PlanOptions): {
	from: number;
	to: number;
	at: number;
	shots: number[];
} {
	const at = Math.min(Math.max(opts.at, 0), opts.length);
	const from = Math.max(0, at - opts.before);
	const to = Math.min(opts.length, at + opts.after);
	const shots = new Set<number>([Math.round(at * 10) / 10]);
	const step = Math.max(1, Math.ceil((to - from) / (MAX_SHOTS - 1)));
	for (let second = from; second <= to; second += step) {
		shots.add(Math.round(second * 10) / 10);
	}
	return {
		from,
		to,
		at,
		shots: [...shots].sort((left, right) => left - right),
	};
}

export interface SliceOptions {
	fs: Fs;
	ps: Ps;
	dir: string;
	at?: number;
	moment?: number;
	before?: number;
	after?: number;
}

async function run(ps: Ps, command: string[], what: string): Promise<string> {
	const result = await ps.spawnCapture(command);
	if (result.exitCode !== 0) {
		throw new Error(`${what} failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

/**
 * Cuts the screenshots and a silent clip around a moment of a session into
 * `slices/<id>/`. `moment` is a rank in `moments.jsonl`; `at` is video seconds.
 */
export async function sliceSession(opts: SliceOptions): Promise<SliceResult> {
	const { fs, ps, dir } = opts;
	const manifest = JSON.parse(
		await fs.read(`${dir}/manifest.json`),
	) as Manifest & { files?: Record<string, string> };
	const recording = (await fs.readdir(dir)).find((name) =>
		name.startsWith("recording."),
	);
	if (!recording) {
		throw new Error(`${dir} has no recording to slice`);
	}
	let at = opts.at;
	let span = { before: opts.before, after: opts.after };
	if (opts.moment !== undefined) {
		const found = parseMomentsFile(
			await fs.read(`${dir}/${MOMENTS_JSONL}`).catch(() => ""),
		).moments.find((moment) => moment.rank === opts.moment);
		if (!found) {
			throw new Error(`No moment ${opts.moment} in ${dir}/moments.md`);
		}
		const start = (found.start - manifest.startedAt) / 1000;
		const end = (found.end - manifest.startedAt) / 1000;
		at = start;
		// Cover the whole moment, with the padding on both sides.
		span = {
			before: opts.before ?? DEFAULT_PADDING,
			after: (opts.after ?? DEFAULT_PADDING) + Math.max(0, end - start),
		};
	}
	if (at === undefined) {
		throw new Error("Give --at <time> or --moment <n>");
	}
	const recorded = Number.parseFloat(
		await run(
			ps,
			[
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=nw=1:nk=1",
				`${dir}/${recording}`,
			],
			"ffprobe reading the recording",
		),
	);
	// MediaRecorder webm has no duration header; fall back to the manifest.
	const length = Number.isFinite(recorded)
		? recorded
		: ((manifest.stoppedAt ?? manifest.startedAt) - manifest.startedAt) / 1000;
	const plan = planSlice({
		at,
		before: span.before ?? DEFAULT_PADDING,
		after: span.after ?? DEFAULT_PADDING,
		length,
	});
	const id = `${plan.at.toFixed(1)}s`;
	const folder = `${dir}/slices/${id}`;
	await fs.mkdir(folder, { recursive: true });
	const clip = `${folder}/clip.mp4`;
	await run(
		ps,
		[
			"ffmpeg",
			"-v",
			"error",
			"-ss",
			String(plan.from),
			"-to",
			String(plan.to),
			"-i",
			`${dir}/${recording}`,
			"-an",
			"-vf",
			"scale='min(1280,iw)':-2",
			"-c:v",
			"libx264",
			"-crf",
			"28",
			"-preset",
			"veryfast",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			"-y",
			clip,
		],
		"ffmpeg cutting the clip",
	);
	const shots: string[] = [];
	for (const second of plan.shots) {
		const file = `${folder}/shot-${second.toFixed(1).padStart(6, "0")}${second === Math.round(plan.at * 10) / 10 ? "-at" : ""}.jpg`;
		await run(
			ps,
			[
				"ffmpeg",
				"-v",
				"error",
				"-ss",
				String(second),
				"-i",
				`${dir}/${recording}`,
				"-frames:v",
				"1",
				"-q:v",
				"3",
				"-y",
				file,
			],
			"ffmpeg taking a screenshot",
		);
		shots.push(file);
	}
	const result: SliceResult = {
		folder,
		from: plan.from,
		to: plan.to,
		at: plan.at,
		clip,
		shots,
	};
	await fs.write(`${folder}/slice.json`, JSON.stringify(result, null, 2));
	return result;
}
