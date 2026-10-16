import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { readFiles } from "./attachments";
import { conversationOf } from "./conversation-given";
import { fail } from "./exit";
import type { Git } from "./git";
import type { WorktreeService } from "./worktree-service";

export interface AttachOptions {
	/** Task whose files these are. Defaults to the one `cwd` is a worktree for. */
	task?: string;
	/** Files it holds to drop first, by path or by the name they were stored under. */
	remove?: string[];
	/**
	 * Conversation to keep the files with. Defaults to the one whose agent runs
	 * the command; with neither, they stay with the task and go when it does.
	 */
	conversation?: string;
}

/**
 * Stores files for a task's questions to show, in a folder arbor owns, so
 * the screenshots and recordings an agent takes never land in a commit.
 * An agent in a conversation has them kept with it, so a merged task's
 * report card still shows them; any other agent's go when the task merges or
 * is removed. Prints where each was stored, which is the path a question
 * names.
 */
export async function attach(
	deps: {
		service: WorktreeService;
		git: Git;
		log: Logger;
		fs: Fs;
		ps: Ps;
	},
	paths: string[],
	cwd: string,
	{ task, remove = [], conversation: given }: AttachOptions = {},
): Promise<string[]> {
	const { service, git, log } = deps;
	const name = task || service.taskFor(await git.currentBranch(cwd));
	if (!name) {
		fail(
			"usage",
			"not in a task worktree: pass --task <name> to attach from elsewhere",
		);
	}
	const found = await service.find(name);
	if (!found.state) {
		fail("not_found", `no task named '${name}' to attach files to`, {
			task: name,
		});
	}
	// An agent outside any conversation keeps its files with the task.
	const conversation =
		given || (await service.conversation()) !== undefined
			? await conversationOf(service, given ?? "")
			: undefined;
	const folders = await service.filesOf(name);
	const held = (await Promise.all(folders.map((each) => each.held()))).flat();
	if (paths.length === 0 && remove.length === 0) {
		log.info(
			[
				`${name} holds ${held.length} file${held.length === 1 ? "" : "s"}`,
				...held.map((file) => `  ${file.path}  ${megabytes(file.bytes)}`),
			].join("\n"),
		);
		return [];
	}
	const matches = (path: string, named: string) =>
		path === named || basename(path) === named;
	const unknown = remove.find(
		(named) => !held.some((file) => matches(file.path, named)),
	);
	if (unknown !== undefined) {
		fail(
			"not_found",
			`'${name}' holds no file '${unknown}': nothing was changed`,
			{ task: name, file: unknown },
		);
	}
	const kept = held.filter(
		(file) => !remove.some((named) => matches(file.path, named)),
	);
	const added = await readFiles(deps, paths);
	const capacity = service.config.attachmentCapacity;
	const here =
		conversation === undefined
			? undefined
			: service.attached(conversation, name);
	const total =
		kept.reduce((sum, file) => sum + file.bytes, 0) +
		added.reduce((sum, file) => sum + file.bytes.length, 0);
	if (total > capacity) {
		fail(
			"too_large",
			`that would have '${name}' hold ${megabytes(total)} of files, past its ${megabytes(capacity)}: nothing was changed. Remove files no question shows with --remove, or attach a shorter recording`,
			{ task: name, bytes: total, capacity },
		);
	}
	if (conversation !== undefined && here) {
		const dropped = held
			.filter((file) => !kept.includes(file) && here.owns(file.path))
			.reduce((sum, file) => sum + file.bytes, 0);
		const bytes =
			(await service.conversationBytes(conversation)) -
			dropped +
			added.reduce((sum, file) => sum + file.bytes.length, 0);
		const limit = service.config.artifactConversationCapacity;
		if (bytes > limit) {
			fail(
				"too_large",
				`that would have this conversation hold ${megabytes(bytes)} of artifacts and attached files, past its ${megabytes(limit)}: nothing was changed. Remove files no question shows with --remove`,
				{ conversation, bytes, capacity: limit },
			);
		}
	}
	const gone = held
		.filter((file) => !kept.includes(file))
		.map((file) => file.path);
	for (const folder of folders) {
		await folder.remove(gone);
	}
	const stored = await (here ?? service.files(name)).store(added);
	log.info(
		[
			`${color.green("attached")} ${stored.length} file${stored.length === 1 ? "" : "s"} to ${name}, holding ${megabytes(total)} of ${megabytes(capacity)}`,
			...stored.map((path) => `  ${path}`),
			...(remove.length === 0 ? [] : [`  removed ${remove.length}`]),
			...(stored.length === 0
				? []
				: [
						"",
						`Name each in a question by the path above, as ![what](<path>). ${conversation === undefined ? "They go when the task merges or is removed." : "They stay with the conversation."}`,
					]),
		].join("\n"),
	);
	return stored;
}

function megabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
