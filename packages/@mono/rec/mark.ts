import type { Fs } from "core/system";

/** Where a running `rec` says which origin its server is on, for `rec mark`. */
export function serverFile(home: string): string {
	return `${home}/server.json`;
}

/** Posts an agent's remark to the running rec server; throws a message for the agent when it cannot. */
async function postMark(fs: Fs, home: string, text: string): Promise<void> {
	const file = serverFile(home);
	const notRunning = "rec is not running: start it with `bin/rec`";
	if (!(await fs.exists(file))) {
		throw new Error(notRunning);
	}
	const { origin } = JSON.parse(await fs.read(file)) as { origin: string };
	let response: Response;
	try {
		response = await fetch(`${origin}/__rec/mark`, {
			method: "POST",
			body: JSON.stringify({ text }),
		});
	} catch {
		throw new Error(notRunning);
	}
	if (!response.ok) {
		throw new Error(`rec could not take the remark: ${await response.text()}`);
	}
}

export interface RecStatus {
	running: boolean;
	name?: string;
	recording?: boolean;
	/** While recording: when it started, wall-clock ms. */
	startedAt?: number;
	/** While recording: whether the recording has audio. */
	mic?: "on" | "off";
	/** While recording: whether the laser trail is drawing (Option held). */
	laser?: boolean;
}

/** Whether rec is running, and if so the session's name and whether it is recording. */
async function readStatus(fs: Fs, home: string): Promise<RecStatus> {
	const file = serverFile(home);
	if (!(await fs.exists(file))) {
		return { running: false };
	}
	try {
		const { origin } = JSON.parse(await fs.read(file)) as { origin: string };
		const response = await fetch(`${origin}/__rec/status`, {
			signal: AbortSignal.timeout(2000),
		});
		const body = (await response.json()) as {
			name?: string;
			recording: boolean;
			startedAt?: number;
			mic?: "on" | "off";
			laser?: boolean;
		};
		return {
			running: true,
			name: body.name,
			recording: body.recording,
			startedAt: body.startedAt,
			mic: body.mic,
			laser: body.laser,
		};
	} catch {
		// The file outlived a rec that crashed.
		return { running: false };
	}
}

/** Talks to the running rec server found under a home folder. */
export class RecClient {
	constructor(
		private readonly fs: Fs,
		private readonly home: string,
	) {}

	mark(text: string): Promise<void> {
		return postMark(this.fs, this.home, text);
	}

	status(): Promise<RecStatus> {
		return readStatus(this.fs, this.home);
	}
}
