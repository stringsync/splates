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

/** Answers the CLI's `/__rec/mark` post by handing its text to `mark`. */
export async function markResponse(
	request: Request,
	mark: (text: string) => void,
): Promise<Response> {
	// A page in the working window could post here; only a request with no
	// Origin (the CLI's) is an agent.
	if (request.headers.has("origin")) {
		return new Response("forbidden", { status: 403 });
	}
	try {
		const body = (await request.json()) as { text?: unknown };
		mark(typeof body.text === "string" ? body.text : "");
		return new Response("ok");
	} catch (error) {
		return new Response((error as Error).message, { status: 409 });
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
	/** How the last recording ended; absent before one has, and from an older rec. */
	lastOutcome?:
		| { status: "saved"; name: string }
		| { status: "failed"; reason: string };
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
			lastOutcome?: RecStatus["lastOutcome"];
		};
		return {
			running: true,
			name: body.name,
			recording: body.recording,
			startedAt: body.startedAt,
			mic: body.mic,
			laser: body.laser,
			lastOutcome: body.lastOutcome,
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
