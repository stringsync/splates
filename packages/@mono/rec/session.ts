import type { Resource } from "core/disposable";
import type { Fs } from "core/system";
import type { RecorderStats } from "./protocol";

/** What made the session, so a reader knows what the folder holds and where it came from. */
export interface Source {
	kind:
		| "screencast"
		| "mic"
		| "console"
		| "network"
		| "docker"
		| "tail"
		| "pointer";
	detail: string;
}

/** `manifest.json`: when the session ran, what it recorded from and which files it wrote. */
export interface Manifest {
	version: 1;
	/** Display identity, independent of the storage folder. Older sessions may omit it. */
	name?: string;
	/** When the recording starts, in wall-clock ms: video time 0. */
	startedAt: number;
	stoppedAt: number;
	sources: Source[];
	/** True when the mic could not be opened: the recording has no audio and was not transcribed. */
	micOff?: boolean;
	/** True when the session was started with `--no-mic`: remarks narrate it, so a missing transcript is no failure. */
	noMic?: boolean;
	/** Why transcription was deferred and how to retry with a key. */
	transcription?: { status: "skipped"; reason: string; retry: string };
	/** Each file the session wrote, by what it is. */
	files: Record<string, string>;
	video: { mimeType: string; width: number; height: number };
	stats: RecorderStats & { received: number; dropped: number };
}

/** The extension a recording's MIME type is written with. */
export function recordingName(mimeType: string): string {
	return mimeType.startsWith("video/mp4") ? "recording.mp4" : "recording.webm";
}

/** A session folder being written: the recording as it arrives, the manifest at the end. */
export class SessionFolder implements Resource {
	private active = false;
	private name = "";

	constructor(
		private readonly fs: Fs,
		readonly dir: string,
		readonly sessionName?: string,
	) {}

	async begin(mimeType: string): Promise<void> {
		await this.fs.mkdir(this.dir, { recursive: true });
		this.name = recordingName(mimeType);
		await this.fs.appendBytes(this.recording, new Uint8Array());
		this.active = true;
	}

	dispose(): void {
		this.active = false;
	}

	get recording(): string {
		return `${this.dir}/${this.name}`;
	}

	async append(chunk: Uint8Array): Promise<void> {
		if (this.active) {
			await this.fs.appendBytes(this.recording, chunk);
		}
	}

	async finish(
		manifest: Omit<Manifest, "files" | "version">,
		files: Record<string, string> = {},
	): Promise<Manifest> {
		this.active = false;
		const written: Manifest = {
			version: 1,
			...manifest,
			name: this.sessionName ?? manifest.name,
			files: { recording: this.name, manifest: "manifest.json", ...files },
		};
		await this.fs.write(
			`${this.dir}/manifest.json`,
			`${JSON.stringify(written, null, 2)}\n`,
		);
		return written;
	}
}
