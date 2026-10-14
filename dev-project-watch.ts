import { basename, dirname } from "node:path";
import type { Resource } from "webappwiz/disposable";
import { Debouncer, Duration, SystemTimer } from "webappwiz/time";
import { type EventSink, eventStream, type StreamWatcher } from "./dev-http";
import type { DevContext, Project } from "./dev-project";
import { PLAN_FILE } from "./plan";
import { fingerprint, type Snapshot, snapshot } from "./snapshot";

/** How long changes to a repo's files settle before it is read again. */
export const SETTLE = Duration.ms(50);

/**
 * What one project's pages hear of its repo: its records, read whole, and a
 * stream that says `changed` whenever what they show moved. The repo is
 * watched only while a page listens.
 */
export class ProjectWatch implements StreamWatcher {
	/** The streams of the pages listening. */
	private readonly open = new Set<EventSink>();
	private last = "";
	private watches: Resource[] = [];
	private readonly trees = new Map<string, Resource>();
	private poll: ReturnType<typeof setInterval> | null = null;
	// A write lands as a temp file renamed into place, and a merge moves
	// several things at once: one read once they settle covers them all.
	private readonly settle = new Debouncer(new SystemTimer(), SETTLE);
	// An agent's edits come in bursts, each one re-reading every task's
	// changed files, so they wait for a longer quiet than a record does.
	private readonly edits = new Debouncer(new SystemTimer(), EDITS_SETTLE);

	/** Watches `project`, read once now so the first change is told apart. */
	static async start(
		project: Project,
		context: DevContext,
	): Promise<ProjectWatch> {
		const watch = new ProjectWatch(project, context);
		watch.last = fingerprint(await watch.read());
		return watch;
	}

	private constructor(
		private readonly project: Project,
		private readonly context: DevContext,
	) {}

	/** The whole repo, as a page shows it. */
	read(): Promise<Snapshot> {
		const { service, todos, creds, fs, ps } = this.project;
		return snapshot({
			service,
			todos,
			creds,
			fs,
			home: ps.env("HOME"),
			release: this.context.release,
			behind: this.context.behind,
			unbuilt: this.context.unbuilt,
			slot: this.context.slot,
		});
	}

	// What a page shows is spread across arbor's records, the branches'
	// refs and each worktree's ARBOR.md, so all three are watched, and a
	// change anywhere in them reads the repo again to see what moved.
	async tick(): Promise<void> {
		// Read only for a page that would hear of it. One that connects later
		// may hear of a change it already fetched, which costs it one refetch.
		if (this.open.size === 0) {
			return;
		}
		const now = await this.read();
		this.follow(now.tasks.map((task) => task.worktree));
		const print = fingerprint(now);
		if (print === this.last) {
			return;
		}
		this.last = print;
		for (const stream of this.open) {
			stream.enqueue(encoder.encode("data: changed\n\n"));
		}
	}

	/** Reads the repo again soon, telling its pages if anything moved. */
	readonly changed = (): void =>
		this.settle.call(() => {
			this.tick().catch((error: unknown) =>
				this.project.log.error(String(error)),
			);
		});

	private readonly edited = (): void => this.edits.call(this.changed);

	/** The stream a page listens to for `changed`. */
	events(): Response {
		return eventStream(this.open, this);
	}

	opened(): void {
		if (this.open.size === 1) {
			this.arm();
		}
	}

	closed(): void {
		if (this.open.size === 0) {
			this.disarm();
		}
	}

	dispose(): void {
		this.disarm();
	}

	// Watched only while a page listens, the way the poll before it read.
	private arm(): void {
		const { fs, arborDir, service, log } = this.project;
		const gitDir = dirname(arborDir);
		const conversationsDir = `${arborDir}/conversations`;
		try {
			this.watches = [
				fs.watch(
					arborDir,
					(path) => {
						// An agent's turn streams into its log: nothing a page shows.
						if (
							path !== conversationsDir &&
							!path.startsWith(`${conversationsDir}/`)
						) {
							this.changed();
						}
					},
					{ recursive: true },
				),
				fs.watch(`${gitDir}/refs`, this.changed, { recursive: true }),
				// Its own entries, of which only `packed-refs` names branches:
				// `index` moves on every `git status`.
				fs.watch(gitDir, (path) => {
					if (basename(path) === "packed-refs") {
						this.changed();
					}
				}),
			];
		} catch (error) {
			log.error(
				`arbor dev cannot watch ${service.git.root}, so it polls it: ${String(error)}`,
			);
			this.disarm();
			this.poll = setInterval(this.changed, POLL_MS);
		}
		this.changed();
	}

	private disarm(): void {
		for (const watch of [...this.watches, ...this.trees.values()]) {
			watch.dispose();
		}
		this.watches = [];
		this.trees.clear();
		this.settle.cancel();
		this.edits.cancel();
		if (this.poll !== null) {
			clearInterval(this.poll);
			this.poll = null;
		}
	}

	/**
	 * Watches each worktree in `paths`, and no other: its ARBOR.md, and its
	 * files as they are edited, which move its counts and its systems.
	 */
	private follow(paths: string[]): void {
		if (this.open.size === 0 || this.poll !== null) {
			return;
		}
		for (const [path, watch] of this.trees) {
			if (!paths.includes(path)) {
				watch.dispose();
				this.trees.delete(path);
			}
		}
		for (const path of paths) {
			if (this.trees.has(path)) {
				continue;
			}
			try {
				this.trees.set(
					path,
					this.project.fs.watch(
						path,
						(file) => {
							if (basename(file) === PLAN_FILE) {
								this.changed();
							} else if (!file.includes("/node_modules/")) {
								this.edited();
							}
						},
						{ recursive: true },
					),
				);
			} catch {
				// Its worktree is gone: the task shows as orphaned, which no
				// longer moves.
			}
		}
	}
}

/**
 * How often a repo that cannot be watched is re-read to decide whether open
 * pages should refetch.
 */
const POLL_MS = 2_000;

/** How long edits to a worktree's files settle before the repo is read again. */
const EDITS_SETTLE = Duration.ms(500);

const encoder = new TextEncoder();
