import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import type { JobSize } from "./job-size";

/**
 * The room jobs on this machine claim on runners still booting, kept in a
 * file so two `splates run`s here count each other's: a booting runner has
 * room for a job only past what the jobs waiting for it claim. A claim
 * whose process is gone frees its room. Read and written under the
 * placement lock its caller holds.
 */
export class RunnerClaims {
	constructor(
		private readonly file: string,
		private readonly ps: Ps,
	) {}

	/** What the jobs other than `job` claim on machine `machine`. */
	async claimed(machine: string, job: string): Promise<JobSize> {
		return (await this.read())
			.filter((claim) => claim.machine === machine && claim.job !== job)
			.reduce(
				(sum, claim) => ({
					cpus: sum.cpus + claim.cpus,
					memory: sum.memory + claim.memory,
				}),
				{ cpus: 0, memory: 0 },
			);
	}

	/** Claims `size` on machine `machine` for `job`, in place of any claim it held. */
	async claim(job: string, machine: string, size: JobSize): Promise<void> {
		const claims = (await this.read()).filter((each) => each.job !== job);
		await this.keep([...claims, { job, machine, ...size, pid: process.pid }]);
	}

	/** Lets go of `job`'s claim. */
	async release(job: string): Promise<void> {
		const claims = await this.read();
		if (claims.some((each) => each.job === job)) {
			await this.keep(claims.filter((each) => each.job !== job));
		}
	}

	private async read(): Promise<Claim[]> {
		const read = await readFile(this.file, "utf8").catch(() => "[]");
		const parsed = Claims.safeParse(JSON.parse(read));
		return (parsed.success ? parsed.data : []).filter((claim) =>
			this.ps.alive(claim.pid),
		);
	}

	private async keep(claims: Claim[]): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		await writeFile(this.file, JSON.stringify(claims));
	}
}

const Claims = z.array(
	z.object({
		job: z.string(),
		/** The cloud's id of the machine it waits for. */
		machine: z.string(),
		cpus: z.number(),
		memory: z.number(),
		pid: z.number(),
	}),
);

type Claim = z.infer<typeof Claims>[number];
