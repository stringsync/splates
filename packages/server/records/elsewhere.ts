import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import {
	type ElsewhereBoards,
	type ElsewhereFollower,
	type ElsewhereTask,
	TaskStore,
	Tasks,
} from "../board";
import type { Projects } from "../projects";
import { Finished } from "../tasks";
import { ProjectHome } from "./home";

/** One other project's records, opened to read its board. */
interface Opened {
	home: ProjectHome;
	store: TaskStore;
	tasks: Tasks;
	finished: Finished;
}

/**
 * Reads the boards of the other splates projects on this machine, for a
 * task that waits on one of theirs; dispose of it once done, which closes
 * each project it opened.
 */
export class OpenBoards implements ElsewhereBoards, Disposable {
	private readonly opened = new Map<string, Promise<Opened | null>>();

	constructor(
		private readonly deps: { fs: Fs; ps: Ps; log: Logger },
		private readonly projects: Projects,
	) {}

	async root(slug: string): Promise<string | null> {
		const found = (await this.projects.list()).find(
			(each) => each.slug.toLowerCase() === slug.toLowerCase() && !each.gone,
		);
		return found?.root ?? null;
	}

	async slug(root: string): Promise<string> {
		return (
			(await this.projects.list()).find((each) => each.root === root)?.slug ??
			root.split("/").filter(Boolean).at(-1) ??
			root
		);
	}

	async find(root: string, id: number): Promise<ElsewhereTask | null> {
		const opened = await this.open(root);
		if (opened === null) {
			return null;
		}
		const listed = (await opened.tasks.all()).find((each) => each.id === id);
		if (listed !== undefined) {
			const { stage, subject, lane, takenBy } = listed.state;
			return {
				status: takenBy !== null || stage === "running" ? "working" : stage,
				subject,
				lane,
				takenBy,
			};
		}
		// Off the list, a started one goes on until it merges or is removed.
		const record = await opened.store.read(id);
		if (record?.task !== undefined) {
			return {
				status: "working",
				subject: record.subject,
				lane: record.lane,
				takenBy: record.task,
			};
		}
		const merged = (await opened.finished.list()).find(
			(each) =>
				each.ended === "merged" &&
				each.commit !== null &&
				(each.id === id || each.took.some((took) => took.id === id)),
		);
		return merged?.commit == null
			? { status: "removed" }
			: { status: "merged", commit: merged.commit };
	}

	async following(root: string): Promise<ElsewhereFollower[]> {
		const found: ElsewhereFollower[] = [];
		for (const project of await this.projects.list()) {
			if (project.gone || project.root === root) {
				continue;
			}
			const opened = await this.open(project.root);
			for (const task of (await opened?.tasks.all()) ?? []) {
				const waits = task.blockedElsewhere.filter(
					(blocker) =>
						blocker.project === root &&
						blocker.landed === undefined &&
						!blocker.lost,
				);
				for (const { id } of waits) {
					found.push({
						blocker: id,
						project: project.root,
						slug: project.slug,
						id: task.id,
						subject: task.subject,
						stage: task.state.stage,
					});
				}
			}
		}
		return found;
	}

	[Symbol.dispose](): void {
		for (const opening of this.opened.values()) {
			void opening.then((opened) => opened?.home.dispose());
		}
		this.opened.clear();
	}

	/** The records of the project at `root`, or null for one that has none. */
	private open(root: string): Promise<Opened | null> {
		let opening = this.opened.get(root);
		if (opening === undefined) {
			opening = (async () => {
				const home = new ProjectHome(root, {
					...this.deps,
					projects: this.projects,
				});
				if (!(await home.exists())) {
					return null;
				}
				const storage = await home.open();
				const store = new TaskStore(storage);
				return {
					home,
					store,
					tasks: new Tasks(store),
					// Only read here, so how many it keeps never matters.
					finished: new Finished(
						storage,
						this.deps.fs,
						Number.MAX_SAFE_INTEGER,
					),
				};
			})().catch((error: unknown) => {
				this.deps.log.error(`could not read the tasks of ${root}: ${error}`);
				this.opened.delete(root);
				return null;
			});
			this.opened.set(root, opening);
		}
		return opening;
	}
}
