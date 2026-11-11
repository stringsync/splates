/** Words, utterances and the timeline they make; none of it touches a file or the network. */

/** A silence this long, in seconds, ends an utterance. */
export const PAUSE_SECONDS = 0.8;
/** The most audio whisper-1 takes in one request. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** A chunk is cut to this share of the limit, so a bitrate wobble never tips it over. */
const CHUNK_SHARE = 0.8;

export interface Word {
	word: string;
	/** Seconds from the start of the recording. */
	start: number;
	end: number;
}

export interface Utterance {
	start: number;
	end: number;
	text: string;
	words: Word[];
}

export interface Transcript {
	version: 1;
	model: "whisper-1";
	/** The names given to whisper as its prompt. */
	prompt: string;
	/** When video time 0 was, in wall-clock ms. */
	startedAt: number;
	text: string;
	words: Word[];
	utterances: Utterance[];
}

export interface Chunk {
	start: number;
	length: number;
}

/** Where to cut audio of `bytes` and `duration` seconds so no chunk is over the upload limit. One chunk when it fits. */
export function planChunks(
	duration: number,
	bytes: number,
	limit = MAX_UPLOAD_BYTES,
): Chunk[] {
	if (bytes <= limit || duration <= 0) {
		return [{ start: 0, length: duration }];
	}
	const count = Math.ceil(bytes / (limit * CHUNK_SHARE));
	const length = duration / count;
	return Array.from({ length: count }, (_, i) => ({
		start: i * length,
		length: i === count - 1 ? duration - i * length : length,
	}));
}

/** The words of one chunk's response, moved to where that chunk sits in the recording. */
export function shiftWords(words: Word[], offset: number): Word[] {
	return words.map((item) => ({
		word: item.word,
		start: item.start + offset,
		end: item.end + offset,
	}));
}

/** Splits words into utterances wherever the gap between two is a pause. */
export function utterances(words: Word[], pause = PAUSE_SECONDS): Utterance[] {
	const out: Utterance[] = [];
	let current: Word[] = [];
	const flush = () => {
		const first = current[0];
		const last = current.at(-1);
		if (first && last) {
			out.push({
				start: first.start,
				end: last.end,
				text: current
					.map((item) => item.word.trim())
					.join(" ")
					.trim(),
				words: current,
			});
		}
		current = [];
	};
	for (const word of words) {
		const last = current.at(-1);
		if (last && word.start - last.end >= pause) {
			flush();
		}
		current.push(word);
	}
	flush();
	return out;
}

export function clock(seconds: number): string {
	const total = Math.max(0, seconds);
	const minutes = Math.floor(total / 60);
	const rest = total - minutes * 60;
	return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** A line of `timeline.md` that is not narration: where in a log to look, at what video time. */
export interface Pointer {
	/** Seconds into the video. */
	at: number;
	text: string;
	/** What the line opens with; "see" when a pointer into a file. */
	label?: string;
}

/** How wide a window of log lines one pointer covers, in seconds. */
const WINDOW = 10;

/**
 * Pointers into a log file, one per window of lines: the lines' numbers and
 * how many were errors, never the lines themselves. Lines open with the ISO
 * time Chrome stamped them with, and lines before the recording are left out.
 */
export function logPointers(
	file: string,
	text: string,
	startedAt: number,
): Pointer[] {
	const windows = new Map<
		number,
		{ first: number; last: number; count: number; errors: number }
	>();
	text.split("\n").forEach((line, index) => {
		const match = /^(\S+)\s+(\w+)/.exec(line);
		const when = match ? Date.parse(match[1] as string) : Number.NaN;
		if (Number.isNaN(when) || when < startedAt) {
			return;
		}
		const key = Math.floor((when - startedAt) / 1000 / WINDOW);
		const win = windows.get(key) ?? {
			first: index + 1,
			last: index + 1,
			count: 0,
			errors: 0,
		};
		win.first = Math.min(win.first, index + 1);
		win.last = Math.max(win.last, index + 1);
		win.count++;
		if (/^(ERROR|EXCEPTION)\b/.test(match?.[2]?.toUpperCase() ?? "")) {
			win.errors++;
		}
		windows.set(key, win);
	});
	return [...windows.entries()]
		.sort(([left], [right]) => left - right)
		.map(([key, win]) => {
			const lines =
				win.first === win.last ? `${win.first}` : `${win.first}-${win.last}`;
			const errors = win.errors > 0 ? `, ${win.errors} errors` : "";
			return {
				at: key * WINDOW,
				text: `${file} lines ${lines} (${win.count} lines${errors}) in ${clock(key * WINDOW)}-${clock((key + 1) * WINDOW)}`,
			};
		});
}

interface EventTarget {
	component?: string;
	selector?: string;
	text?: string;
}

export function target(item: EventTarget): string {
	const parts = [
		item.component ? `<${item.component}>` : "",
		item.text ? `"${item.text}"` : "",
		item.selector ? `(${item.selector})` : "",
	].filter(Boolean);
	return parts.join(" ") || "an unnamed element";
}

/** The `events.jsonl` lines the timeline mentions; the rest of the pointer samples stay in the file. */
interface TimelineEvent extends EventTarget {
	at: number;
	type: string;
	url?: string;
	still?: string;
	area?: number[];
	elements?: EventTarget[];
	label?: string;
	by?: "agent" | "person";
}

/** Pointers for the clicks, typing, routes, highlights and pauses in the text of an `events.jsonl`. */
export function eventPointers(text: string, startedAt: number): Pointer[] {
	const out: Pointer[] = [];
	let lastPause = "";
	for (const line of text.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		let event: TimelineEvent;
		try {
			event = JSON.parse(line) as TimelineEvent;
		} catch {
			continue;
		}
		if (event.at < startedAt) {
			continue;
		}
		const at = (event.at - startedAt) / 1000;
		const still = event.still ? ` -> ${event.still}` : "";
		switch (event.type) {
			case "click":
				out.push({
					at,
					label: "pointer",
					text: `click on ${target(event)}${still}`,
				});
				break;
			case "mark":
				out.push({
					at,
					label: event.by === "person" ? "typed remark:" : "remark:",
					text: `${event.label ?? ""}${still}`,
				});
				break;
			case "type":
				out.push({ at, label: "pointer", text: `typed in ${target(event)}` });
				break;
			case "route":
				out.push({
					at,
					label: "pointer",
					text: `route changed to ${event.url}`,
				});
				break;
			case "highlight": {
				const [left, top, width, height] = event.area ?? [];
				const over = (event.elements ?? []).map(target).join(", ");
				out.push({
					at,
					label: "pointer",
					text: `highlighted ${width}x${height} at ${left},${top}${over ? ` over ${over}` : ""}${still}`,
				});
				break;
			}
			case "paused": {
				const what = target(event);
				if (what !== lastPause) {
					out.push({ at, label: "pointer", text: `paused over ${what}` });
				}
				lastPause = what;
				break;
			}
		}
	}
	return out;
}

export interface TimelineOptions {
	micOff?: boolean;
	noMic?: boolean;
	noKey?: boolean;
}

/** Renders `timeline.md`: the narration and pointers to the logs, merged in video time. */
export function renderTimeline(
	transcript: Transcript,
	pointers: Pointer[] = [],
	opts: TimelineOptions = {},
): string {
	const { micOff = false, noMic = false, noKey = false } = opts;
	const lines = [
		"# Timeline",
		"",
		"Video time, mm:ss.s from the start of the recording.",
		"",
	];
	const entries = [
		...transcript.utterances.map((line) => ({
			at: line.start,
			text: `narration: ${line.text}`,
		})),
		...pointers.map((pointer) => ({
			at: pointer.at,
			text: `${pointer.label ?? "see"} ${pointer.text}`,
		})),
	].sort((left, right) => left.at - right.at);
	for (const entry of entries) {
		lines.push(`- ${clock(entry.at)} ${entry.text}`);
	}
	if (noMic) {
		lines.push(
			"_Recorded with --no-mic: no audio, so the remarks above narrate it._",
		);
	} else if (micOff) {
		lines.push(
			"_The mic was off: no audio was recorded, so there is no narration._",
		);
	} else if (noKey) {
		lines.push(
			"_No transcript: OPENAI_API_KEY is not set. Audio is saved in the recording; set the key and run `rec transcribe <dir>` to add narration._",
		);
	} else if (transcript.utterances.length === 0) {
		lines.push("_No speech was heard._");
	}
	return `${lines.join("\n")}\n`;
}

/** The prompt that primes whisper with the project's names. */
export function namesPrompt(names: string[]): string {
	return names.length === 0
		? ""
		: `Names used in this session: ${names.join(", ")}.`;
}
