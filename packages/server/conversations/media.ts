import {
	capturedFileName,
	findInlineMedia,
	type InlineMediaScanOptions,
	ownsConversationAttached,
	readValidatedMedia,
	rewriteInlineMedia,
} from "../artifacts";
import { movedPath } from "../config";
import type { Log } from "../storage";
import type { Entry } from "./entry";
import type { ConversationDeps, ConversationHost } from "./host";
import type { Message } from "./state";

/** Folder name used when a conversation captures media with no open task. */
const NO_TASK = "_no-task";

/** One local media reference captured from an agent reply into conversation storage. */
export interface CapturedMedia {
	/** The raw Markdown destination written by the agent (e.g. `/tmp/a.png`, `./a.png`, `file:///tmp/a.png`). */
	from: string;
	/** The splates-owned absolute path where the validated copy was stored. */
	to: string;
	/** The resolved local source path on disk when captured, for reuse in `SPLATES.md` and finished records. */
	source: string;
}

/**
 * Applies captured media rewrites to every text part of `message`, answering
 * whether any part changed.
 */
export function applyCapturedMedia(
	message: Message,
	files: readonly CapturedMedia[],
): boolean {
	if (files.length === 0) {
		return false;
	}
	const replacements = new Map(files.map((each) => [each.from, each.to]));
	let changed = false;
	for (const part of message.parts) {
		if (part.type !== "text") {
			continue;
		}
		const next = rewriteInlineMedia(part.text, replacements);
		if (next !== part.text) {
			part.text = next;
			changed = true;
		}
	}
	return changed;
}

/**
 * The latest stored copy for each resolved local source path captured in `log`,
 * for `SPLATES.md` views and finished task archiving to reuse.
 */
export async function capturedMedia(
	log: Log<Entry>,
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const entries = await log.replay().catch(() => []);
	for (const entry of entries) {
		if (entry.kind !== "media") {
			continue;
		}
		for (const file of entry.files) {
			map.set(file.source, file.to);
		}
	}
	return map;
}

/**
 * Automatically validates and copies local images and videos embedded in a
 * conversation's agent replies into conversation-owned storage, logging each
 * mapping so both live updates and replayed logs serve the stored copy.
 */
export class ConversationMedia {
	private queue: Promise<void> = Promise.resolve();
	/** Rejected local files cached by `mtimeMs:size` so streaming chunks skip re-reading them. */
	private readonly rejected = new Map<string, string>();

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
	) {}

	/**
	 * Scans the latest agent message for uncaptured local media references,
	 * validates and stores each within size limits, logs the rewrites, and
	 * updates the in-memory message parts.
	 */
	capture(opts: InlineMediaScanOptions = {}): Promise<void> {
		const next = this.queue.then(() => this.captureNow(opts));
		this.queue = next.catch(() => {});
		return next;
	}

	private async captureNow(opts: InlineMediaScanOptions): Promise<void> {
		const host = this.host;
		const deps = this.deps;
		const last = host.state.messages.findLast((each) => each.role === "agent");
		if (last === undefined) {
			return;
		}
		const refs = last.parts.flatMap((part) =>
			part.type === "text" ? findInlineMedia(part.text, host.cwd, opts) : [],
		);
		if (refs.length === 0) {
			return;
		}
		const conversationsDir = deps.storage.locate("");
		const isOwned = (path: string): boolean => {
			const normalized = movedPath(path);
			return (
				ownsConversationAttached(conversationsDir, normalized) ||
				deps.ownsMedia?.(normalized) === true
			);
		};
		const bucket = safeBucket(host.state.task ?? NO_TASK);
		const keyPrefix = `${host.state.id}/attached/${bucket}`;
		const collection = deps.storage.collection(keyPrefix);
		let existingNames: Set<string> | null = null;
		let conversationBytes: number | null = null;

		const seenRaw = new Set<string>();
		const resolvedStored = new Map<string, string | null>();
		const captured: CapturedMedia[] = [];

		for (const ref of refs) {
			if (seenRaw.has(ref.raw)) {
				continue;
			}
			seenRaw.add(ref.raw);

			if (isOwned(ref.resolved)) {
				// Already in splates-owned storage; normalize `file://` or relative refs to the owned path.
				if (ref.raw !== ref.resolved) {
					captured.push({
						from: ref.raw,
						to: ref.resolved,
						source: ref.resolved,
					});
				}
				continue;
			}

			if (resolvedStored.has(ref.resolved)) {
				const stored = resolvedStored.get(ref.resolved) ?? null;
				if (stored !== null) {
					captured.push({ from: ref.raw, to: stored, source: ref.resolved });
				}
				continue;
			}

			const stat = await deps.fs.stat(ref.resolved).catch(() => null);
			if (
				stat === null ||
				stat.isDirectory() ||
				stat.size <= 0 ||
				stat.size > deps.artifacts.file
			) {
				resolvedStored.set(ref.resolved, null);
				continue;
			}
			const stamp = `${stat.mtimeMs}:${stat.size}`;
			if (this.rejected.get(ref.resolved) === stamp) {
				resolvedStored.set(ref.resolved, null);
				continue;
			}

			const valid = await readValidatedMedia(
				deps.fs,
				ref.resolved,
				deps.artifacts.file,
			);
			if (valid === null) {
				this.rejected.set(ref.resolved, stamp);
				resolvedStored.set(ref.resolved, null);
				continue;
			}

			const name = capturedFileName(valid.bytes, ref.resolved);
			if (existingNames === null) {
				existingNames = new Set(await collection.list().catch(() => []));
			}
			if (!existingNames.has(name)) {
				const used: number =
					conversationBytes ??
					(await deps.storage.size(`${host.state.id}/artifacts`)) +
						(await deps.storage.size(`${host.state.id}/attached`));
				conversationBytes = used;
				if (used + valid.bytes.length > deps.artifacts.conversation) {
					resolvedStored.set(ref.resolved, null);
					continue;
				}
				await collection.writeBytes(name, valid.bytes);
				existingNames.add(name);
				conversationBytes = used + valid.bytes.length;
			}

			const stored = await deps.storage.materialize(`${keyPrefix}/${name}`);
			resolvedStored.set(ref.resolved, stored);
			captured.push({ from: ref.raw, to: stored, source: ref.resolved });
		}

		if (captured.length === 0) {
			return;
		}
		if (applyCapturedMedia(last, captured)) {
			host.log.write({ kind: "media", files: captured });
			host.changed();
		}
	}
}

function safeBucket(name: string): string {
	return name.replace(/[^\w.-]+/g, "-") || NO_TASK;
}
