import { basename } from "node:path";
import type { Fs } from "core/system";
import {
	capturedFileName,
	findInlineMedia,
	readValidatedMedia,
	rewriteInlineMedia,
} from "../artifacts";
import type * as Board from "../board";
import { movedPath } from "../config";
import { capturedMedia } from "../conversations";
import type { WorktreeService } from "./worktree-service";

/**
 * Rewrites validated local Markdown image/video references in an active task's
 * `SPLATES.md` to splates-owned paths so the page can display them via `/api/file`
 * without modifying `SPLATES.md` on disk. Reuses conversation-captured copies
 * when present, or stores content-addressed copies in the task's started folder.
 */
export async function capturePlanMedia({
	service,
	queue,
	fs,
	task,
	worktree,
	plan,
	conversations,
}: {
	service: WorktreeService;
	queue: Pick<Board.Tasks, "owns">;
	fs: Fs;
	task: string;
	worktree: string;
	plan: string;
	conversations: readonly (string | null)[];
}): Promise<string> {
	if (!plan.includes("![")) {
		return plan;
	}
	const refs = findInlineMedia(plan, worktree);
	if (refs.length === 0) {
		return plan;
	}
	const isOwned = (path: string): boolean => {
		const normalized = movedPath(path);
		return (
			service.owns(normalized) ||
			queue.owns(normalized) ||
			service.finished.owns(normalized)
		);
	};

	const replacements = new Map<string, string>();
	const pending = [];
	for (const ref of refs) {
		if (replacements.has(ref.raw)) {
			continue;
		}
		if (isOwned(ref.resolved)) {
			if (ref.raw !== ref.resolved) {
				replacements.set(ref.raw, ref.resolved);
			}
			continue;
		}
		pending.push(ref);
	}
	if (pending.length === 0) {
		return rewriteInlineMedia(plan, replacements);
	}

	const folders = await service.filesOf(task);
	const heldFiles = (
		await Promise.all(folders.map((folder) => folder.held()))
	).flat();
	const heldByName = new Map<string, string>();
	let totalHeld = 0;
	for (const file of heldFiles) {
		heldByName.set(basename(file.path), file.path);
		totalHeld += file.bytes;
	}
	const own = await service.files(task);

	let conversationCaptured: Map<string, string> | null = null;
	const loadCaptured = async (): Promise<Map<string, string>> => {
		if (conversationCaptured !== null) {
			return conversationCaptured;
		}
		conversationCaptured = new Map<string, string>();
		const ids = [
			...new Set(
				conversations.filter((id): id is string => id !== null && id !== ""),
			),
		];
		for (const id of ids) {
			const map = await capturedMedia(service.conversationLog(id));
			for (const [source, stored] of map) {
				if (!conversationCaptured.has(source)) {
					conversationCaptured.set(source, stored);
				}
			}
		}
		return conversationCaptured;
	};

	const resolvedStored = new Map<string, string | null>();
	for (const ref of pending) {
		if (replacements.has(ref.raw)) {
			continue;
		}
		if (resolvedStored.has(ref.resolved)) {
			const stored = resolvedStored.get(ref.resolved) ?? null;
			if (stored !== null) {
				replacements.set(ref.raw, stored);
			}
			continue;
		}

		const valid = await readValidatedMedia(
			fs,
			ref.resolved,
			service.config.artifactFileCapacity,
		);
		if (valid !== null) {
			const name = capturedFileName(valid.bytes, ref.resolved);
			const existing = heldByName.get(name);
			if (existing !== undefined) {
				resolvedStored.set(ref.resolved, existing);
				replacements.set(ref.raw, existing);
				continue;
			}
			if (
				own !== null &&
				totalHeld + valid.bytes.length <= service.config.attachmentCapacity
			) {
				const stored = await own.storeNamed(name, valid.bytes);
				heldByName.set(name, stored);
				totalHeld += valid.bytes.length;
				resolvedStored.set(ref.resolved, stored);
				replacements.set(ref.raw, stored);
				continue;
			}
			resolvedStored.set(ref.resolved, null);
			continue;
		}

		// If the original file was deleted after the conversation captured it, reuse the stored copy.
		if (!(await fs.exists(ref.resolved))) {
			const fallback = (await loadCaptured()).get(ref.resolved);
			if (
				fallback !== undefined &&
				isOwned(fallback) &&
				(await fs.exists(fallback))
			) {
				resolvedStored.set(ref.resolved, fallback);
				replacements.set(ref.raw, fallback);
				continue;
			}
		}
		resolvedStored.set(ref.resolved, null);
	}

	return rewriteInlineMedia(plan, replacements);
}

/**
 * Pre-reads validated local media referenced in `plan` before a worktree is
 * removed so relative or worktree-local media survives archiving into `Finished`.
 */
export async function preReadPlanMedia(
	fs: Fs,
	plan: string,
	worktree: string,
	{
		isOwned,
		maxFileBytes,
		maxTotalBytes,
	}: {
		isOwned: (path: string) => boolean;
		maxFileBytes: number;
		maxTotalBytes: number;
	},
): Promise<Map<string, Uint8Array>> {
	const read = new Map<string, Uint8Array>();
	if (!plan.includes("![")) {
		return read;
	}
	let total = 0;
	for (const ref of findInlineMedia(plan, worktree)) {
		if (read.has(ref.resolved) || isOwned(movedPath(ref.resolved))) {
			continue;
		}
		const valid = await readValidatedMedia(fs, ref.resolved, maxFileBytes);
		if (valid === null || total + valid.bytes.length > maxTotalBytes) {
			continue;
		}
		read.set(ref.resolved, valid.bytes);
		total += valid.bytes.length;
	}
	return read;
}
