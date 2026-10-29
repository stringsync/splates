import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { merge } from "../merge";
import { PLAN_FILE } from "../plans";
import type { Repository } from "../records";
import { add, remove } from "../tasks";
import type { Cascade, CascadeStep } from "./cascade";
import { movePins, type Pin, pinsMatch } from "./graph";

/** Move pins on an isolated task, then land through the same gate and merge as the CLI. */
export class MechanicalAdoption {
	constructor(private readonly repo: Repository & { ps: Ps; log: Logger }) {}

	async run(
		ship: Cascade,
		step: CascadeStep,
		pins: Pin[],
		log: (text: string) => Promise<void>,
		opts: MechanicalAdoptionOptions,
	): Promise<boolean> {
		const repo = this.repo;
		const { git, service, fs, config } = repo;
		const task = this.taskOf(ship, step);
		// The base is only read here; all writes happen in the task's worktree.
		if (
			(await git.currentBranch(git.root)) !== config.trunk ||
			(await git.out(git.root, "status", "--porcelain")).trim() !== ""
		) {
			throw new Error(
				`mechanical adoption requires a clean ${config.trunk} main tree`,
			);
		}
		if (await pinsMatch(fs, git.root, pins)) {
			const left = await service.find(task);
			if (!left.gone) {
				await remove(repo, task, { reason: "nothing" });
			}
			await log("The base already pins the target versions.\n");
			return true;
		}
		let tree = await service.find(task);
		if (tree.gone) {
			await add(repo, task, {
				goal: `Adopt ${pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")} for this ship.`,
			});
			tree = await service.find(task);
		} else {
			tree = await tree.take();
		}
		await log(`Adopting in ${tree.path}\n`);
		await movePins(fs, tree.path, pins);
		if (!(await pinsMatch(fs, tree.path, pins))) {
			throw new Error(
				"the adoption tree no longer contains every target dependency",
			);
		}
		// No manifest changes and no commits means the base already matches.
		if (
			(await tree.commitsAhead()) === 0 &&
			(await tree.uncommitted()).length === 0
		) {
			await remove(repo, task, { reason: "nothing" });
			await log("The base already pins the target versions.\n");
			return true;
		}
		for (const command of ["bun install", ...opts.afterBump]) {
			opts.signal?.throwIfAborted();
			await log(`$ ${command}\n`);
			const result = await repo.ps.spawnCapture(["sh", "-c", command], {
				cwd: tree.path,
				signal: opts.signal,
			});
			await log(result.stdout + result.stderr);
			if (result.exitCode !== 0) {
				throw new Error(`${command} exited ${result.exitCode}`);
			}
		}
		opts.signal?.throwIfAborted();
		if ((await tree.uncommitted()).length > 0) {
			const committed = await git.commitAll(
				tree.path,
				`Adopt ${pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}`,
			);
			if (committed.code !== 0) {
				throw new Error(committed.stderr || committed.stdout);
			}
		}
		await fs.write(
			`${tree.path}/${PLAN_FILE}`,
			`# ${task}\n\n## Goal\n\nAdopt the ship's target versions.\n\n## Outcome\n\nPins moved, dependencies installed and upstream refresh commands run.\n`,
		);
		await log("Running the project's merge gate and landing adoption.\n");
		opts.signal?.throwIfAborted();
		await merge(
			repo,
			tree.path,
			{},
			{
				message: `Adopt ${pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}`,
			},
		);
		await log("Adoption merged.\n");
		return false;
	}

	/** Discard an unfinished mechanical task once the person ends its ship. */
	async discard(ship: Cascade, step: CascadeStep): Promise<void> {
		const task = this.taskOf(ship, step);
		const tree = await this.repo.service.find(task);
		if (!tree.gone) {
			await remove(this.repo, task, { reason: "moot" });
		}
	}

	private taskOf(ship: Cascade, step: CascadeStep): string {
		return `ship-${ship.started.replace(/[^0-9]/g, "")}-${step.slug}`;
	}
}

export interface MechanicalAdoptionOptions {
	afterBump: string[];
	signal?: AbortSignal;
}
