import { fail } from "../exit";
import type { TrustDecision } from "./types";

export interface TrustScope {
	project: string;
	/** Repository-relative directory prefix, including the trailing slash. */
	path: string;
}

/** When a declaration was active, so removing it only affects future decisions. */
export interface ScopeDeclaration extends TrustScope {
	addedAt: string;
	removedAt: string | null;
}

/** A task attempt's working file list, replaced by its final diff when it ends. */
export interface TrustTaskFiles {
	project: string;
	task: string;
	startedAt: string;
	endedAt: string | null;
	files: string[];
}

export function scopePath(input: string): string {
	const path = input.trim().replace(/\/+$/, "");
	if (
		path === "" ||
		/[\\:\p{Cc}]/u.test(path) ||
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		fail(
			"usage",
			"Enter a directory path relative to the project, such as packages/web/",
		);
	}
	return `${path}/`;
}

export function scopeFor(
	files: readonly string[],
	scopes: readonly ScopeDeclaration[],
	at: string,
): string | undefined {
	if (files.length === 0) {
		return undefined;
	}
	let deepest: string | undefined;
	for (const each of scopes) {
		if (
			each.addedAt <= at &&
			(each.removedAt === null || each.removedAt > at) &&
			each.path.length > (deepest?.length ?? 0) &&
			files.every((file) => file.startsWith(each.path))
		) {
			deepest = each.path;
		}
	}
	return deepest;
}

export function taskFilesKey({
	project,
	task,
}: {
	project: string;
	task: string;
}): string {
	return JSON.stringify([project, task]);
}

/** Resolve older answers as soon as their task has a diff, keeping each answer's declaration window. */
export function scopedDecisions(
	decisions: TrustDecision[],
	declarations: readonly ScopeDeclaration[],
	snapshots: Record<string, TrustTaskFiles[]>,
): TrustDecision[] {
	const byProject = Map.groupBy(declarations, (each) => each.project);
	return decisions.map((decision) => {
		const scopes = byProject.get(decision.project);
		if (decision.scope !== undefined || scopes === undefined) {
			return decision;
		}
		let files = decision.files;
		const { project, task, at } = decision;
		if (files === undefined && task !== null) {
			const attempts = snapshots[taskFilesKey({ project, task })];
			// A decision can be observed after the task's merge, when the turn ends.
			files = attempts?.findLast(
				(each) => each.startedAt <= (decision.taskAt ?? at),
			)?.files;
		}
		const scope = scopeFor(files ?? [], scopes, at);
		return scope === undefined ? decision : { ...decision, scope };
	});
}
