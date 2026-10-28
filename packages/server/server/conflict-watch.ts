import { type AsyncResource, Disposer } from "webappwiz/disposable";
import { Debouncer, Duration, SystemTimer } from "webappwiz/time";
import { type Conversations, SERVER_TOLD } from "../conversations";
import {
	ConflictChecks,
	landingNotice,
	landingsOverlapping,
	overlapWarnings,
	TaskOverlaps,
} from "../tasks";
import { conflictWarning, earlyWarning } from "./early-warning";
import type { Project } from "./project";

/** Checks active tasks after ref moves, even with no page open. */
export class ConflictWatch implements AsyncResource {
	private readonly timer = new SystemTimer();
	private readonly settled = new Debouncer(this.timer, Duration.ms(500));
	private readonly checks: ConflictChecks;
	private readonly disposer = new Disposer();
	private readonly overlaps = new Set<string>();
	private readonly told = new Map<string, string>();
	private running = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly project: Project,
		private readonly conversations: Conversations | null,
	) {
		this.checks = new ConflictChecks(project.storage);
	}

	async start(): Promise<void> {
		const { fs, git, storage, log } = this.project;
		const changed = () => this.settled.call(() => void this.sweep());
		try {
			const common = await git.commonDir();
			this.disposer.use(
				fs.watch(`${common}/refs`, changed, { recursive: true }),
			);
			this.disposer.use(
				fs.watch(common, (path) => {
					if (path.endsWith("/packed-refs")) {
						changed();
					}
				}),
			);
			const tasks = storage.watch("tasks", { recursive: true });
			tasks.events.on("changed", changed);
			this.disposer.use(tasks);
		} catch (error) {
			log.error(`Conflict checks will poll: ${String(error)}`);
		}
		// Also catches the first uncommitted edits and worker branch moves.
		this.disposer.use(
			this.timer.setInterval(() => void this.sweep(), Duration.secs(15)),
		);
		await this.sweep();
	}

	/** Checks active tasks now, notifying their working agents of new warnings. */
	sweep(): Promise<void> {
		this.running = this.running
			.then(async () => {
				if (this.disposed) {
					return;
				}
				const tasks = await this.project.service.list();
				const peers = tasks.some((each) => !this.overlaps.has(each.task))
					? await new TaskOverlaps(this.project.service).files()
					: [];
				for (const worktree of tasks) {
					if (worktree.status !== "working") {
						continue;
					}
					const result = await this.checks.check(worktree);
					if (result !== null) {
						await this.tell(
							worktree.task,
							"conflict",
							conflictWarning(worktree.base, result.conflict.files),
						);
					}
					if (result === null) {
						for (const key of this.told.keys()) {
							if (key.startsWith(`${worktree.task}:conflict:`)) {
								this.told.delete(key);
							}
						}
					}
					const landings = await landingsOverlapping(worktree);
					for (const key of this.told.keys()) {
						if (
							key.startsWith(`${worktree.task}:landed:`) &&
							!landings.some((each) => key.includes(`:${each.commit}:`))
						) {
							this.told.delete(key);
						}
					}
					for (const landing of landings) {
						await this.tell(
							worktree.task,
							`landed:${landing.commit}`,
							landingNotice(landing, worktree.base),
						);
					}
					if (!this.overlaps.has(worktree.task)) {
						const files =
							peers.find((each) => each.task === worktree.task)?.files ?? [];
						if (files.length > 0) {
							this.overlaps.add(worktree.task);
							const warnings = overlapWarnings(peers, worktree.task, "", files);
							if (warnings.length > 0) {
								await this.tell(worktree.task, "overlap", warnings.join("\n"));
							}
						}
					}
				}
			})
			.catch((error: unknown) => this.project.log.error(String(error)));
		return this.running;
	}

	private async tell(
		task: string,
		kind: "conflict" | "overlap" | `landed:${string}`,
		words: string,
	): Promise<void> {
		for (const conversation of (await this.conversations?.list()) ?? []) {
			const key = `${task}:${kind}:${conversation.state.id}`;
			if (
				conversation.state.task !== task ||
				conversation.state.archived ||
				conversation.state.status !== "running" ||
				this.told.get(key) === words
			) {
				continue;
			}
			this.told.set(key, words);
			void conversation
				.prompt(earlyWarning(task, words), [], undefined, {
					told: SERVER_TOLD,
					stop: conversation.state.taking === "queue",
				})
				.catch((error: unknown) => {
					this.told.delete(key);
					this.project.log.error(String(error));
				});
		}
	}

	async disposeAsync(): Promise<void> {
		this.disposed = true;
		this.settled.cancel();
		this.disposer.dispose();
		await this.running;
	}
}
