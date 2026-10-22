import { basename } from "node:path";
import type { Resource } from "webappwiz/disposable";
import { Debouncer, Duration, SystemTimer } from "webappwiz/time";
import { LEGACY_PLAN_FILE } from "../config";
import { PLAN_FILE } from "../plans";
import { fingerprint, type Snapshot, snapshot, TaskDetails } from "../tasks";
import { type EventSink, eventStream, type StreamWatcher } from "./http";
import type { DevContext, Project } from "./project";

/** How long changes to a repo's files settle before it is read again. */
export const SETTLE = Duration.ms(50);

/**
 * What one project's pages hear of its repo: its records, read whole and kept
 * until something in them moves, and a stream that says `changed` whenever
 * what they show moved.
 */
export class ProjectWatch implements StreamWatcher {
	/** The streams of the pages listening. */
	private readonly open = new Set<EventSink>();
	/** What else listens as a page does, such as the every-project feed. */
	private readonly heard = new Set<() => void>();
	private last = "";
	/** Bumped by every sign the repo moved, so a read from before it is stale. */
	private moves = 0;
	/** The last read, kept while no move has come since it began. */
	private kept: Kept | null = null;
	/** The read under way, which every caller at its move count shares. */
	private reading: { moves: number; snapshot: Promise<Snapshot> } | null = null;
	/** Whether the records are watched, without which nothing kept is trusted. */
	private watching = false;
	private disposed = false;
	private watches: Resource[] = [];
	private readonly trees = new Map<string, Tree>();
	private poll: ReturnType<typeof setInterval> | null = null;
	/**
	 * Reads each task, keeping what git said of it until a ref or a
	 * worktree's file moves, so a board write re-reads only the records.
	 */
	private readonly details: TaskDetails;
	// A write lands as a temp file renamed into place, and a merge moves
	// several things at once: one read once they settle covers them all.
	private readonly settle = new Debouncer(new SystemTimer(), SETTLE);
	// An agent's edits come in bursts, each one re-reading every task's
	// changed files, so they wait for a longer quiet than a record does.
	private readonly edits = new Debouncer(new SystemTimer(), EDITS_SETTLE);

	/** Watches `project`, read once now so the first page opens on it. */
	static async start(
		project: Project,
		context: DevContext,
	): Promise<ProjectWatch> {
		const watch = new ProjectWatch(project, context);
		watch.watchRecords();
		watch.last = fingerprint(await watch.current());
		return watch;
	}

	private constructor(
		private readonly project: Project,
		private readonly context: DevContext,
	) {
		this.details = new TaskDetails({ fs: project.fs });
	}

	/**
	 * The whole repo, as a page shows it: the one kept since nothing moved,
	 * or read again. Only a worktree's edits can lag, by as long as they take
	 * to settle, or while no page listens, until one does.
	 */
	async current(): Promise<Snapshot> {
		const kept = this.kept;
		if (kept === null || !this.watching || kept.moves !== this.moves) {
			return this.live(await this.fresh());
		}
		// A lease goes stale with time alone, which no watcher sees.
		if (Date.now() - kept.at > MAX_AGE.ms) {
			this.revalidate();
		}
		return this.live(kept.snapshot);
	}

	/**
	 * Marks the repo moved after a page's own write and reads it again behind
	 * the answer, telling its pages. The write need not wait for the read:
	 * the page's refetch shares it, and the move already makes that refetch
	 * read fresh.
	 */
	tick(): void {
		this.moves++;
		this.push().catch((error: unknown) =>
			this.project.log.error(String(error)),
		);
	}

	/** Reads the repo again soon, telling its pages if anything moved. */
	readonly changed = (): void => {
		this.moves++;
		this.settle.call(() => {
			this.push().catch((error: unknown) =>
				this.project.log.error(String(error)),
			);
		});
	};

	/** As {@link changed}, for a move that git may say something new of. */
	private readonly moved = (): void => {
		this.details.moved();
		this.changed();
	};

	private readonly edited = (worktree: string): void => {
		this.details.moved(worktree);
		this.edits.call(this.changed);
	};

	/** The stream a page listens to for `changed`. */
	events(): Response {
		return eventStream(this.open, this);
	}

	/**
	 * Calls `changed` whenever what a page shows moved, listening as a page
	 * does, so worktrees' edits move it too, until disposed.
	 */
	listen(changed: () => void): Resource {
		const own = () => changed();
		this.heard.add(own);
		this.opened();
		return {
			dispose: () => {
				if (this.heard.delete(own)) {
					this.closed();
				}
			},
		};
	}

	opened(): void {
		if (this.listening === 1) {
			this.arm();
		}
	}

	closed(): void {
		if (this.listening === 0) {
			this.disarm();
		}
	}

	/** How many pages, and whatever else, listen. */
	private get listening(): number {
		return this.open.size + this.heard.size;
	}

	dispose(): void {
		this.disposed = true;
		this.heard.clear();
		this.disarm();
		for (const watch of [...this.watches, ...this.trees.values()]) {
			watch.dispose();
		}
		this.watches = [];
		this.trees.clear();
	}

	/** The repo read whole, the server's own facts aside. */
	private async read(): Promise<Snapshot> {
		const { service, tasks, creds, fs, ps } = this.project;
		const { details } = this;
		// Unwatched, nothing says when git moved, so it is asked every time.
		if (!this.watching) {
			details.moved();
		}
		return snapshot({
			project: await this.context.everywhere.slug(service.git.root),
			service,
			tasks,
			creds,
			fs,
			details,
			home: ps.env("HOME"),
		});
	}

	/** `snapshot` with what the server says of itself now, which it may have learned since. */
	private live(snapshot: Snapshot): Snapshot {
		const { release, behind, unbuilt, slot } = this.context;
		return { ...snapshot, release, behind, unbuilt, slot };
	}

	/** A read begun at the current move count, kept once it lands. */
	private fresh(): Promise<Snapshot> {
		if (this.reading?.moves === this.moves) {
			return this.reading.snapshot;
		}
		const moves = this.moves;
		const at = Date.now();
		const snapshot = this.read()
			.then((read) => {
				if (this.kept === null || moves >= this.kept.moves) {
					this.kept = { snapshot: read, moves, at };
				}
				this.follow(read.tasks.map((task) => task.worktree));
				return read;
			})
			.finally(() => {
				if (this.reading?.snapshot === snapshot) {
					this.reading = null;
				}
			});
		this.reading = { moves, snapshot };
		return snapshot;
	}

	/** Tells the pages listening, if what they show moved since they last heard. */
	private async push(): Promise<void> {
		// Read only for a page that would hear of it. One that connects later
		// may hear of a change it already fetched, which costs it one refetch.
		if (this.listening === 0) {
			return;
		}
		this.tell(await this.current());
	}

	/**
	 * Reads again behind what is kept, which still answers meanwhile, and
	 * tells the pages listening if it moved.
	 */
	private revalidate(): void {
		this.fresh()
			.then((read) => {
				if (this.listening > 0) {
					this.tell(this.live(read));
				}
			})
			.catch((error: unknown) => this.project.log.error(String(error)));
	}

	private tell(now: Snapshot): void {
		const print = fingerprint(now);
		if (print === this.last) {
			return;
		}
		this.last = print;
		for (const stream of this.open) {
			stream.enqueue(encoder.encode("data: changed\n\n"));
		}
		for (const changed of this.heard) {
			changed();
		}
	}

	// What a page shows is spread across splates's records, the branches'
	// refs and each worktree's SPLATES.md, so all three are watched from the
	// start: what is kept is only as good as the watchers that clear it.
	private watchRecords(): void {
		const { fs, storage, service, log } = this.project;
		const gitDir = `${service.git.root}/.git`;
		try {
			const records = storage.watch("", { recursive: true });
			records.events.on("changed", (changed) => {
				// An agent's turn streams into its log: nothing a page shows.
				const under = (dir: string) =>
					changed === dir || changed.startsWith(`${dir}/`);
				if (
					!LOCK_PATH.test(changed) &&
					!under("conversations") &&
					!under("log") &&
					changed !== "log.jsonl"
				) {
					this.changed();
				}
			});
			this.watches = [
				records,
				fs.watch(`${gitDir}/refs`, this.moved, { recursive: true }),
				// Its own entries, of which only `packed-refs` names branches:
				// `index` moves on every `git status`.
				fs.watch(gitDir, (path) => {
					if (basename(path) === "packed-refs") {
						this.moved();
					}
				}),
			];
			this.watching = true;
		} catch (error) {
			log.error(
				`splates server cannot watch ${service.git.root}, so it polls it: ${String(error)}`,
			);
			for (const watch of this.watches) {
				watch.dispose();
			}
			this.watches = [];
		}
	}

	// A page that arrives may have missed edits made while none listened, so
	// it reads again behind the snapshot it fetches, rather than ahead of it,
	// asking git anew: a worktree's files are watched only while one listens.
	private arm(): void {
		if (!this.watching) {
			this.poll = setInterval(this.changed, POLL_MS);
			this.changed();
			return;
		}
		this.details.moved();
		this.follow(this.kept?.snapshot.tasks.map((task) => task.worktree) ?? []);
		this.revalidate();
	}

	private disarm(): void {
		this.settle.cancel();
		this.edits.cancel();
		if (this.poll !== null) {
			clearInterval(this.poll);
			this.poll = null;
		}
		this.follow(this.kept?.snapshot.tasks.map((task) => task.worktree) ?? []);
	}

	/**
	 * Watches each worktree in `paths`, and no other: its SPLATES.md always,
	 * and while a page listens, its files as they are edited, which move its
	 * counts. A recursive watch costs a watch per directory
	 * on some systems, so none is kept for a page that is not open.
	 */
	private follow(paths: string[]): void {
		// A read that lands after the server let the project go.
		if (!this.watching || this.disposed) {
			return;
		}
		const deep = this.listening > 0;
		for (const [path, tree] of this.trees) {
			if (!paths.includes(path) || tree.deep !== deep) {
				tree.dispose();
				this.trees.delete(path);
			}
		}
		for (const path of paths) {
			if (this.trees.has(path)) {
				continue;
			}
			try {
				const watch = this.project.fs.watch(
					path,
					(file) => {
						if ([PLAN_FILE, LEGACY_PLAN_FILE].includes(basename(file))) {
							this.changed();
						} else if (!file.includes("/node_modules/")) {
							this.edited(path);
						}
					},
					{ recursive: deep },
				);
				this.trees.set(path, { deep, dispose: () => watch.dispose() });
			} catch {
				// Its worktree is gone: the task shows as orphaned, which no
				// longer moves.
			}
		}
	}
}

/**
 * A lock's directory or what is in it: readers take it too, so it says
 * nothing a page shows, and reading again for it would take it again.
 */
const LOCK_PATH = /\.lock(\/|$)/;

/** A snapshot kept, with the move count and the time its read began. */
interface Kept {
	snapshot: Snapshot;
	moves: number;
	at: number;
}

/** A worktree watched, recursively or for its own entries alone. */
interface Tree extends Resource {
	deep: boolean;
}

/**
 * How long a kept snapshot answers before it is read again behind the
 * answer, for what moves with time alone, such as a lease going stale.
 */
const MAX_AGE = Duration.secs(30);

/**
 * How often a repo that cannot be watched is re-read to decide whether open
 * pages should refetch.
 */
const POLL_MS = 2_000;

/** How long edits to a worktree's files settle before the repo is read again. */
const EDITS_SETTLE = Duration.ms(500);

const encoder = new TextEncoder();
