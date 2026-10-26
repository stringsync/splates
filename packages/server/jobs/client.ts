import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import type { JobSpec, JobSpecJson, JobSubmitter } from "./job";
import { type JobServer, RemoteJob } from "./remote-job";

/** How long a submission waits for the server to answer before it is taken as unreachable. */
export const SUBMIT_WAIT_MS = 5000;

/**
 * Submits jobs to the `splates server` an agent runs under, the one its
 * `SPLATES_DEV` names: each a `RemoteJob` held over its event stream.
 * Rejects when the server cannot be reached, so the caller can run without.
 */
export class JobClient implements JobSubmitter {
	constructor(
		private readonly server: JobServer,
		private readonly log: Logger,
	) {}

	/** The server `ps`'s environment names, or null outside one, as `serverOf` reads it. */
	static of(
		ps: Ps,
		log: Logger,
		{ send = fetch }: { send?: JobServer["send"] } = {},
	): JobClient | null {
		const url = ps.env("SPLATES_DEV");
		return url ? new JobClient({ url, send }, log) : null;
	}

	async submit(spec: JobSpec, signal?: AbortSignal): Promise<RemoteJob> {
		const { url, send } = this.server;
		const response = await send(`${url}/api/jobs`, {
			method: "POST",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: url },
			body: JSON.stringify(json(spec)),
			signal: AbortSignal.any([
				AbortSignal.timeout(SUBMIT_WAIT_MS),
				...(signal === undefined ? [] : [signal]),
			]),
		});
		if (!response.ok) {
			throw new Error(
				`splates server refused the job: ${response.status} ${await response.text()}`,
			);
		}
		const { id } = (await response.json()) as { id: string };
		const job = new RemoteJob(id, this.server, this.log);
		await job.open(signal);
		return job;
	}
}

function json(spec: JobSpec): JobSpecJson {
	const { request, ...rest } = spec;
	return {
		...rest,
		request: {
			resources: request.resources,
			walltimeMs: request.walltime.ms,
			...(request.expected === undefined
				? {}
				: { expectedMs: request.expected.ms }),
		},
	};
}
