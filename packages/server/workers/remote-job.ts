import type { WorkerChannel } from "./channel";
import { type JobParams, JobSaid } from "./job";
import type { WorkerSession } from "./session";

/** How a job on a runner ended: the command's exit code and the files it returned. */
export interface JobResult {
	code: number;
	files: Map<string, Uint8Array>;
}

/** What the server does for a job's runner, beyond the params it opened the channel with. */
export interface JobRun {
	/** The bundle to ship a runner that holds `tip` (null: nothing of the project). Empty where it holds the commit. */
	bundle(tip: string | null): Promise<Uint8Array>;
	/** The command's output, as it comes. */
	output(bytes: Uint8Array): void;
	/** Ends the job on the runner, killing the command, once aborted. */
	signal?: AbortSignal;
}

/**
 * A job running on a runner, seen from the server: it hears what the runner
 * holds, ships the bundle that fills the gap, relays the output as it comes
 * and answers the exit code with the files the job asked for. Rejects with
 * the runner's reason when the job could not run, or when the runner lost it.
 */
export async function runRemoteJob(
	channel: WorkerChannel,
	session: WorkerSession,
	run: JobRun,
): Promise<JobResult> {
	const settled = Promise.withResolvers<JobResult>();
	const files = new Map<string, Uint8Array>();
	let code = 0;
	/** The file whose bytes are arriving, and what of them has. */
	let incoming: { name: string; size: number; parts: Uint8Array[] } | null =
		null;
	let finished = false;
	const finish = (end: () => void) => {
		if (finished) {
			return;
		}
		finished = true;
		end();
		channel.dispose();
	};
	const landed = () => {
		if (incoming === null) {
			return;
		}
		const have = incoming.parts.reduce((sum, each) => sum + each.byteLength, 0);
		if (have >= incoming.size) {
			files.set(incoming.name, Buffer.concat(incoming.parts));
			incoming = null;
		}
	};
	channel.events.on("data", ({ bytes, seq }) => {
		channel.ack(seq);
		if (incoming === null) {
			run.output(bytes);
		} else {
			incoming.parts.push(bytes);
			landed();
		}
	});
	channel.events.on("message", ({ body, seq }) => {
		channel.ack(seq);
		const said = JobSaid.safeParse(body);
		if (!said.success) {
			return;
		}
		const { data } = said;
		switch (data.type) {
			case "have":
				void ship(data.tip);
				break;
			case "exit":
				code = data.code;
				break;
			case "file":
				incoming = { name: data.name, size: data.size, parts: [] };
				landed();
				break;
			case "done":
				finish(() => settled.resolve({ code, files }));
				break;
			case "failed":
				finish(() => settled.reject(new Error(data.reason)));
				break;
			default:
				break;
		}
	});
	channel.events.on("close", () => {
		finish(() =>
			settled.reject(new Error("the runner no longer runs the job")),
		);
	});
	const ship = async (tip: string | null) => {
		try {
			const bundle = await run.bundle(tip);
			if (channel.closed) {
				return;
			}
			for (let at = 0; at < bundle.byteLength; at += 1024 * 1024) {
				if (!channel.write(bundle.subarray(at, at + 1024 * 1024))) {
					await session.drained();
				}
			}
			channel.send({ type: "bundle", bytes: bundle.byteLength });
		} catch (error) {
			finish(() =>
				settled.reject(error instanceof Error ? error : new Error(String(error))),
			);
		}
	};
	const cancel = () => {
		if (!channel.closed) {
			channel.send({ type: "cancel" });
		}
		finish(() => settled.reject(new Error("the job was cancelled")));
	};
	if (run.signal?.aborted) {
		cancel();
	}
	run.signal?.addEventListener("abort", cancel, { once: true });
	return settled.promise.finally(() =>
		run.signal?.removeEventListener("abort", cancel),
	);
}
