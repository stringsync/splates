import { Credentials, Environment, SystemSecretStore } from "core/creds";
import type { Fs, Ps } from "core/system";
import {
	eventPointers,
	logPointers,
	namesPrompt,
	type Pointer,
	planChunks,
	renderTimeline,
	shiftWords,
	type Transcript,
	utterances,
	type Word,
} from "./timeline";

export const KEY_NAME = "OPENAI_API_KEY";

/** The credentials rec reads: the environment first, then the project's and the device's secret store. */
export async function recCredentials(): Promise<Credentials> {
	return new Credentials([
		new Environment(),
		await SystemSecretStore.forProject(),
		SystemSecretStore.device(),
	]);
}

/** The key, or an error that names the cred and how to set it. */
export async function requireKey(credentials: Credentials): Promise<string> {
	try {
		return await credentials.require(KEY_NAME);
	} catch (error) {
		throw new Error(
			`transcription needs ${KEY_NAME}, and it is not set (${error instanceof Error ? error.message : error}); add it with \`bin/mono creds add ${KEY_NAME} --device\``,
		);
	}
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TranscribeOptions {
	ps: Ps;
	fs: Fs;
	/** The session folder holding the recording. */
	dir: string;
	recording: string;
	startedAt: number;
	key: string;
	names: string[];
	fetch?: Fetch;
	limit?: number;
	/** The session had no mic: skip the audio and whisper, and say so in the timeline. */
	micOff?: boolean;
	/** The session ran with --no-mic: remarks narrate it, so the missing speech is no failure. */
	noMic?: boolean;
	/** Use the `transcript.json` already in the folder, so finishing a session again never pays for whisper twice. */
	reuse?: boolean;
}

/** Transcribes the recording's audio, writing `transcript.json` and `timeline.md` next to it. */
export async function transcribe(opts: TranscribeOptions): Promise<Transcript> {
	const { fs, dir } = opts;
	const fetcher: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
	const work = `${dir}/.audio`;
	await fs.mkdir(work, { recursive: true });
	try {
		const transcript: Transcript =
			opts.micOff || opts.noMic || !opts.key
				? {
						version: 1,
						model: "whisper-1",
						prompt: "",
						startedAt: opts.startedAt,
						text: "",
						words: [],
						utterances: [],
					}
				: (opts.reuse && (await existing(fs, dir))) ||
					(await hear(fetcher, work, opts));
		const pointers: Pointer[] = [];
		const logs = (await fs.readdir(`${dir}/logs`).catch(() => [] as string[]))
			.filter((name) => name.endsWith(".log"))
			.sort()
			.map((name) => `logs/${name}`);
		for (const file of logs) {
			pointers.push(
				...logPointers(file, await fs.read(`${dir}/${file}`), opts.startedAt),
			);
		}
		pointers.push(
			...eventPointers(
				await fs.read(`${dir}/events.jsonl`).catch(() => ""),
				opts.startedAt,
			),
		);
		await fs.write(
			`${dir}/timeline.md`,
			renderTimeline(transcript, pointers, {
				micOff: opts.micOff,
				noMic: opts.noMic,
				noKey: !opts.key,
			}),
		);
		return transcript;
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

/** The folder's `transcript.json`, when one was written before. */
async function existing(fs: Fs, dir: string): Promise<Transcript | undefined> {
	if (!(await fs.exists(`${dir}/transcript.json`))) {
		return undefined;
	}
	return JSON.parse(await fs.read(`${dir}/transcript.json`)) as Transcript;
}

/** Extracts the recording's audio and runs it through whisper, writing `transcript.json`. */
async function hear(
	fetcher: Fetch,
	work: string,
	opts: TranscribeOptions,
): Promise<Transcript> {
	const { ps, fs, dir } = opts;
	const full = `${work}/audio.mp3`;
	await run(
		ps,
		[
			"ffmpeg",
			"-v",
			"error",
			"-i",
			opts.recording,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-b:a",
			"32k",
			"-y",
			full,
		],
		"ffmpeg extracting the audio",
	);
	const duration = Number.parseFloat(
		await run(
			ps,
			[
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"csv=p=0",
				full,
			],
			"ffprobe reading the audio",
		),
	);
	const bytes = (await fs.stat(full)).size;
	const chunks = planChunks(
		Number.isFinite(duration) ? duration : 0,
		bytes,
		opts.limit,
	);
	const prompt = namesPrompt(opts.names);
	const words: Word[] = [];
	for (const [i, chunk] of chunks.entries()) {
		let path = full;
		if (chunks.length > 1) {
			path = `${work}/chunk-${i}.mp3`;
			await run(
				ps,
				[
					"ffmpeg",
					"-v",
					"error",
					"-ss",
					String(chunk.start),
					"-t",
					String(chunk.length),
					"-i",
					full,
					"-c",
					"copy",
					"-y",
					path,
				],
				"ffmpeg cutting a chunk",
			);
		}
		const heard = await whisper(
			fetcher,
			opts.key,
			new Uint8Array(await fs.readBytes(path)),
			`chunk-${i}.mp3`,
			prompt,
		);
		words.push(...shiftWords(heard, chunk.start));
	}
	const transcript: Transcript = {
		version: 1,
		model: "whisper-1",
		prompt,
		startedAt: opts.startedAt,
		text: words.map((item) => item.word.trim()).join(" "),
		words,
		utterances: utterances(words),
	};
	await fs.write(
		`${dir}/transcript.json`,
		`${JSON.stringify(transcript, null, 2)}\n`,
	);
	return transcript;
}

async function run(ps: Ps, command: string[], what: string): Promise<string> {
	const result = await ps.spawnCapture(command);
	if (result.exitCode !== 0) {
		throw new Error(`${what} failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

/** One chunk through whisper-1, its words as the chunk heard them. */
async function whisper(
	fetcher: Fetch,
	key: string,
	audio: Uint8Array,
	name: string,
	prompt: string,
): Promise<Word[]> {
	const form = new FormData();
	form.append("model", "whisper-1");
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");
	if (prompt) {
		form.append("prompt", prompt);
	}
	form.append(
		"file",
		new Blob([audio as BlobPart], { type: "audio/mpeg" }),
		name,
	);
	const response = await fetcher(
		"https://api.openai.com/v1/audio/transcriptions",
		{
			method: "POST",
			headers: { authorization: `Bearer ${key}` },
			body: form,
		},
	);
	if (!response.ok) {
		throw new Error(
			`whisper-1 answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
		);
	}
	const body = (await response.json()) as { words?: Word[] };
	return body.words ?? [];
}
