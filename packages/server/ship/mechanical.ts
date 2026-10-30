import { aborts } from "webappwiz/abort";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
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
		if (step.adopt !== "agent" && (await pinsMatch(fs, git.root, pins))) {
			const left = await service.find(task);
			if (!left.gone) {
				await remove(repo, task, { reason: "nothing" });
			}
			await log("The base already pins the target versions.\n");
			return true;
		}
		let tree = await service.find(task);
		if (step.adopt === "agent") {
			const outcome = (await repo.outcomes.list()).find(
				(each) => each.project === git.root && each.task === task,
			);
			if (outcome !== undefined) {
				if (outcome.ended !== "merged") {
					throw new Error("The ship task was removed without merging.");
				}
				return false;
			}
		}
		let numbered = (await repo.tasks.all()).find(
			(each) =>
				each.state.ship?.run === ship.id && each.state.ship.step === step.slug,
		);
		if (step.adopt === "agent" && numbered === undefined) {
			numbered = await repo.tasks.add(`Check ${step.slug} for its ship`, null, {
				slug: task,
				ship: { run: ship.id, step: step.slug },
				ready: true,
				text: this.detail(ship, step),
			});
			await repo.tasks.revise(numbered.id, (state) => ({
				...state,
				ship: { run: ship.id, step: step.slug },
			}));
		}
		if (numbered !== undefined) {
			step.task = numbered.id;
			await opts.assigned?.();
			if (!tree.gone) {
				await numbered.take(task);
			}
		}
		if (tree.gone) {
			await add(repo, task, {
				tasks: numbered === undefined ? [] : [numbered.id],
				goal: `Adopt ${pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")} for this ship.`,
			});
			tree = await service.find(task);
		} else {
			tree = await tree.take();
		}
		await log(`Adopting in ${tree.path}\n`);
		const prepared = numbered?.state.ship?.prepared === true;
		if (!prepared) {
			await movePins(fs, tree.path, pins);
		}
		if (!(await pinsMatch(fs, tree.path, pins))) {
			throw new Error(
				"the adoption tree no longer contains every target dependency",
			);
		}
		// No manifest changes and no commits means the base already matches.
		if (
			step.adopt !== "agent" &&
			(await tree.commitsAhead()) === 0 &&
			(await tree.uncommitted()).length === 0
		) {
			await remove(repo, task, { reason: "nothing" });
			await log("The base already pins the target versions.\n");
			return true;
		}
		if (
			!prepared &&
			(step.adopt !== "agent" || (await tree.commitsAhead()) === 0)
		) {
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
			await this.format(tree.path, await tree.uncommitted(), log, opts.signal);
			if ((await tree.uncommitted()).length > 0) {
				const committed = await git.commitAll(
					tree.path,
					`Adopt ${pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}`,
				);
				if (committed.code !== 0) {
					throw new Error(committed.stderr || committed.stdout);
				}
			}
		}
		if (step.adopt === "agent") {
			if (!prepared) {
				await fs.write(
					`${tree.path}/${PLAN_FILE}`,
					`# ${task}\n\nThis task belongs to a ship.\n\n## Goal\n\n${this.detail(ship, step)}\n`,
				);
				if (numbered !== undefined) {
					await repo.tasks.revise(numbered.id, (state) => ({
						...state,
						ship: { run: ship.id, step: step.slug, prepared: true },
					}));
				}
			}
			if (opts.agent === undefined) {
				throw new Error("Ship agent starts are not configured");
			}
			// The agent claims the task itself; a lease left on the server's pid
			// would make its merge and claim refuse with lease_held.
			await tree.save({ lease: null });
			await opts.agent(task);
			while (true) {
				opts.signal?.throwIfAborted();
				const outcome = (await repo.outcomes.list()).find(
					(each) => each.project === git.root && each.task === task,
				);
				if (outcome !== undefined) {
					if (outcome.ended !== "merged") {
						throw new Error("The ship task was removed without merging.");
					}
					return false;
				}
				await (opts.signal === undefined
					? sleep(Duration.secs(1))
					: aborts.race(opts.signal, sleep(Duration.secs(1))));
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

	/**
	 * Formats the files the refresh commands rewrote with the project's Biome,
	 * which a merge gate's check refuses otherwise: `wiz update` writes
	 * `skills-lock.json` with spaces where the project indents with tabs.
	 */
	private async format(
		cwd: string,
		porcelain: string[],
		log: (text: string) => Promise<void>,
		signal?: AbortSignal,
	): Promise<void> {
		const { fs, ps } = this.repo;
		if (
			!(await fs.exists(`${cwd}/biome.json`)) &&
			!(await fs.exists(`${cwd}/biome.jsonc`))
		) {
			return;
		}
		const paths = porcelain
			// The status code may have lost its leading space to trimming.
			.map((line) => line.trim().split(/\s+/))
			.filter(([status]) => status !== "D")
			.map((parts) => parts.slice(1).join(" ").split(" -> ").pop() ?? "")
			.filter((path) => /\.(?:jsonc?|[cm]?[jt]sx?|css)$/.test(path));
		if (paths.length === 0) {
			return;
		}
		await log(`$ biome format --write ${paths.join(" ")}\n`);
		const result = await ps.spawnCapture(
			[
				"bunx",
				"biome",
				"format",
				"--write",
				"--no-errors-on-unmatched",
				...paths,
			],
			{ cwd, signal },
		);
		await log(result.stdout + result.stderr);
	}

	/** Discard an unfinished mechanical task once the person ends its ship. */
	async discard(ship: Cascade, step: CascadeStep): Promise<void> {
		const task = this.taskOf(ship, step);
		const tree = await this.repo.service.find(task);
		if (!tree.gone) {
			await remove(this.repo, task, { reason: "moot" });
		}
	}

	private detail(ship: Cascade, step: CascadeStep): string {
		return [
			`Ship ${ship.id}, step ${step.slug}.`,
			...step.takes.flatMap((use) =>
				use.pins.map(
					(pin) =>
						`${pin.name}: ${pin.version} → ${ship.steps.find((each) => each.slug === use.project)?.to}. Upstream tags: v${pin.version.replace(/^[~^]/, "")}..v${ship.steps.find((each) => each.slug === use.project)?.to}`,
				),
			),
			"Fix what breaks, then land with `splates merge`: your merge is how you tell the server it is OK to ship, and it publishes only after that, so run no ship command yourself. Never change the release type or bump further. If you cannot, `splates remove <task> --reason blocked` saying why.",
			...(step.adoptFailure === undefined
				? []
				: ["## Mechanical adoption failure", step.adoptFailure]),
			"## Person's instructions",
			step.instructions ?? "",
		].join("\n\n");
	}

	private taskOf(ship: Cascade, step: CascadeStep): string {
		return `ship-${ship.started.replace(/[^0-9]/g, "")}-${step.slug}`;
	}
}

export interface MechanicalAdoptionOptions {
	afterBump: string[];
	agent?: (task: string) => Promise<void>;
	assigned?: () => Promise<void>;
	signal?: AbortSignal;
}
