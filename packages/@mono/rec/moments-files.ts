import type { Fs } from "core/system";
import type { Jev } from "./jev";
import type { Moment, MomentEvent, MomentsResult } from "./moment-types";
import { buildMoments, rankAbout } from "./moments";
import type { Manifest } from "./session";
import { describeSignal } from "./signal-text";
import { MOMENTS_JSONL, type Signal } from "./signals";
import { clock, type Transcript } from "./timeline";

export const MOMENTS_MD = "moments.md";

/** `moments.md`: the ranked moments, in video time, for an agent to read first. */
export function renderMoments(
	result: MomentsResult,
	startedAt: number,
	about?: string,
): string {
	const lines = ["# Moments", ""];
	lines.push(
		about
			? `Ranked against: "${about}". Video time, mm:ss.s from the start of the recording.`
			: "Ranked by how likely each is to be where something went wrong. Video time, mm:ss.s from the start of the recording.",
		"",
	);
	for (const note of result.notes) {
		lines.push(`> ${note}`, "");
	}
	if (result.moments.length === 0) {
		lines.push("_No moments stood out._", "");
	}
	const video = (at: number): string => clock((at - startedAt) / 1000);
	for (const moment of result.moments) {
		const { parts } = moment;
		lines.push(
			`## ${moment.rank}. ${video(moment.start)}-${video(moment.end)} (score ${moment.score.toFixed(2)})`,
			"",
		);
		const why = [
			`code signals ${parts.code.toFixed(2)}`,
			...(parts.speech === undefined
				? []
				: [`speech ${parts.speech.toFixed(2)}`]),
			...(parts.about === undefined
				? []
				: [`about the request ${parts.about.toFixed(2)}`]),
		];
		const judgment = moment.judgment;
		if (judgment?.remark) {
			const top = judgment.remark.probabilities[judgment.remark.choice] ?? 0;
			why.push(`remark: ${judgment.remark.choice} ${top.toFixed(2)}`);
		}
		if (judgment?.problem !== undefined) {
			why.push(`reports a problem ${judgment.problem.toFixed(2)}`);
		}
		if (judgment?.screen !== undefined) {
			why.push(`refers to the screen ${judgment.screen.toFixed(2)}`);
		}
		lines.push(`- why: ${why.join("; ")}`);
		if (moment.said) {
			lines.push(`- said: "${moment.said}"`);
		}
		if (moment.pointed) {
			lines.push(`- pointed at: ${moment.pointed}`);
		}
		for (const signal of moment.signals.filter((item) => !isLog(item))) {
			lines.push(`- ${video(signal.at)} ${describeSignal(signal)}`);
		}
		for (const signal of moment.signals.filter(isLog)) {
			lines.push(
				`- ${video(signal.at)} ${signal.source}: ${describeSignal(signal)}`,
			);
		}
		if (moment.still) {
			lines.push("", `![${moment.rank}](${moment.still})`);
		}
		lines.push("");
	}
	return `${lines.join("\n")}`;
}

/** One line of `moments.jsonl` for a moment; signals keep their own lines. */
export function renderMomentLines(result: MomentsResult): string {
	return result.moments
		.map((moment) => `${JSON.stringify({ moment })}\n`)
		.join("");
}

/** The signals and the earlier moments written in a `moments.jsonl`. */
export function parseMomentsFile(text: string): {
	signals: Signal[];
	moments: Moment[];
} {
	const signals: Signal[] = [];
	const moments: Moment[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as { signal?: string; moment?: Moment };
			if (parsed.moment) {
				moments.push(parsed.moment);
			} else if (parsed.signal) {
				signals.push(parsed as unknown as Signal);
			}
		} catch {
			// A torn line.
		}
	}
	return { signals, moments };
}

/** Reads a session folder, judges and ranks its moments, and writes `moments.md` and `moments.jsonl`. */
export async function writeMoments(opts: {
	fs: Fs;
	dir: string;
	jev?: Jev;
	about?: string;
}): Promise<MomentsResult> {
	const { fs, dir } = opts;
	// A session with no mic has no transcript: its remarks stand in for speech.
	const transcript = await fs.read(`${dir}/transcript.json`).then(
		(text) => JSON.parse(text) as Transcript,
		async (): Promise<Transcript> => ({
			version: 1,
			model: "whisper-1",
			prompt: "",
			startedAt: (JSON.parse(await fs.read(`${dir}/manifest.json`)) as Manifest)
				.startedAt,
			text: "",
			words: [],
			utterances: [],
		}),
	);
	const earlier = parseMomentsFile(
		await fs.read(`${dir}/${MOMENTS_JSONL}`).catch(() => ""),
	);
	const events: MomentEvent[] = (
		await fs.read(`${dir}/events.jsonl`).catch(() => "")
	)
		.split("\n")
		.flatMap((line) => {
			try {
				return line.trim() ? [JSON.parse(line) as MomentEvent] : [];
			} catch {
				return [];
			}
		});
	let result: MomentsResult;
	if (opts.about && earlier.moments.length > 0 && opts.jev) {
		result = { moments: earlier.moments, notes: [] };
	} else {
		result = await buildMoments({
			transcript,
			signals: earlier.signals,
			events,
			jev: opts.jev,
		});
	}
	await fs.write(
		`${dir}/${MOMENTS_JSONL}`,
		earlier.signals.map((signal) => `${JSON.stringify(signal)}\n`).join("") +
			renderMomentLines(result),
	);
	let shown = result;
	if (opts.about) {
		if (!opts.jev) {
			throw new Error("--about needs a TypeSafe key: set TYPESAFE_API_KEY");
		}
		shown = {
			...result,
			moments: await rankAbout(result.moments, opts.about, opts.jev),
		};
	}
	await fs.write(
		`${dir}/${MOMENTS_MD}`,
		renderMoments(shown, transcript.startedAt, opts.about),
	);
	return shown;
}

const isLog = (signal: Signal): boolean => signal.source !== "events";
