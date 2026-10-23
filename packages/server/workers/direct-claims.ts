import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import type { JobSize } from "./job-size";

/**
 * What the `splates run`s on this machine hold on their runners, kept in a
 * file so two count each other's: the room each job claims on the runner it
 * waits for or runs on, and when each runner last ran one, which `reap`
 * judges idleness by. A claim whose process is gone frees its room. Read
 * and written under the placement lock its caller holds.
 */
export class RunnerClaims {
	constructor(
		private readonly file: string,
		private readonly ps: Ps,
	) {}

	/** What the jobs other than `job` claim on machine `machine`. */
	async claimed(machine: string, job = ""): Promise<JobSize> {
		return (await this.read()).claims
			.filter((claim) => claim.machine === machine && claim.job !== job)
			.reduce(
				(sum, claim) => ({
					cpus: sum.cpus + claim.cpus,
					memory: sum.memory + claim.memory,
				}),
				{ cpus: 0, memory: 0 },
			);
	}

	/** How many jobs here hold machine `machine` now. */
	async holding(machine: string): Promise<number> {
		return (await this.read()).claims.filter(
			(claim) => claim.machine === machine,
		).length;
	}

	/** Claims `size` on machine `machine` for `job`, in place of any claim it held. */
	async claim(job: string, machine: string, size: JobSize): Promise<void> {
		const kept = await this.read();
		await this.keep({
			...kept,
			claims: [
				...kept.claims.filter((each) => each.job !== job),
				{ job, machine, ...size, pid: process.pid },
			],
		});
	}

	/** Lets go of `job`'s claim, its runner last used `at`. */
	async release(job: string, at: number): Promise<void> {
		const kept = await this.read();
		const claim = kept.claims.find((each) => each.job === job);
		if (claim === undefined) {
			return;
		}
		await this.keep({
			claims: kept.claims.filter((each) => each !== claim),
			used: { ...kept.used, [claim.machine]: at },
		});
	}

	/** When machine `machine` last ended a job of this machine's, epoch ms; null for never. */
	async used(machine: string): Promise<number | null> {
		return (await this.read()).used[machine] ?? null;
	}

	/** Forgets machine `machine`, gone. */
	async forget(machine: string): Promise<void> {
		const kept = await this.read();
		const { [machine]: _, ...used } = kept.used;
		await this.keep({
			claims: kept.claims.filter((each) => each.machine !== machine),
			used,
		});
	}

	private async read(): Promise<Kept> {
		const read = await readFile(this.file, "utf8").catch(() => "{}");
		const parsed = KeptFile.safeParse(JSON.parse(read));
		const kept = parsed.success ? parsed.data : { claims: [], used: {} };
		return {
			...kept,
			claims: kept.claims.filter((claim) => this.ps.alive(claim.pid)),
		};
	}

	private async keep(kept: Kept): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		await writeFile(this.file, JSON.stringify(kept));
	}
}

const KeptFile = z.object({
	claims: z
		.array(
			z.object({
				job: z.string(),
				/** The cloud's id of the machine it waits for or runs on. */
				machine: z.string(),
				cpus: z.number(),
				memory: z.number(),
				pid: z.number(),
			}),
		)
		.default([]),
	/** When each machine last ended a job, epoch ms, by the cloud's id. */
	used: z.record(z.string(), z.number()).default({}),
});

type Kept = z.infer<typeof KeptFile>;
