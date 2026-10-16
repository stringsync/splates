import { extname } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
import {
	type Artifact,
	Artifacts,
	type ArtifactVersion,
	applyArtifact,
	artifactLimits,
} from "./artifacts";
import { ConversationLog } from "./conversation-log";
import { EXIT, fail, type Reason } from "./exit";
import type { WorktreeService } from "./worktree-service";

/** What `fetch` is used for here, so a test can stand in for it. */
type Send = (url: string, init: RequestInit) => Promise<Response>;

export interface ArtifactDeps {
	service: WorktreeService;
	log: Logger;
	fs: Fs;
	ps: Ps;
	send?: Send;
}

/**
 * Keeps `file` as the next version of the artifact of that name in the
 * conversation `id`, through the `arbor dev` serving this repository when
 * the agent has one in its env, so the page hears of it, else straight into
 * the conversation's log.
 */
export async function addArtifact(
	deps: ArtifactDeps,
	id: string,
	file: { name: string; bytes: Uint8Array },
): Promise<ArtifactVersion> {
	const mimeType = mimeTypeOf(file.name);
	const url = deps.ps.env("ARBOR_DEV");
	const served =
		url === undefined
			? null
			: await serverAdd(deps, url, id, { ...file, mimeType });
	let added = served;
	if (added === null) {
		const store = await open(deps, id);
		added = await store.add({ ...file, mimeType });
	}
	deps.log.info(
		`${color.green("added")} ${file.name} as version ${added.version}, ${megabytes(added.bytes)}`,
	);
	return added;
}

/** Marks the artifact `name` of conversation `id` removed; answers the version that was current. */
export async function removeArtifact(
	deps: ArtifactDeps,
	id: string,
	name: string,
): Promise<number> {
	const held = (await read(deps, id)).find((each) => each.name === name);
	const url = deps.ps.env("ARBOR_DEV");
	if (url === undefined || !(await serverRemove(deps, url, id, name))) {
		await (await open(deps, id)).remove(name);
	}
	deps.log.info(`${color.green("removed")} ${name}: its versions are kept`);
	return held?.current ?? 0;
}

/** Prints what the conversation `id` holds, or, given a `name`, that artifact's versions. */
export async function listArtifacts(
	deps: ArtifactDeps,
	id: string,
	name?: string,
): Promise<void> {
	const held = await read(deps, id);
	if (name !== undefined) {
		const artifact = held.find((each) => each.name === name);
		if (artifact === undefined) {
			fail("not_found", `this conversation holds no artifact '${name}'`, {
				name,
			});
		}
		deps.log.info(
			[
				`${artifact.name}${artifact.removedAt === null ? "" : " (removed)"}`,
				...artifact.versions.map(
					(each) =>
						`  v${each.version}${each.version === artifact.current ? " (current)" : ""}  ${each.mimeType}  ${megabytes(each.bytes)}  ${each.addedAt}${each.gone === null ? "" : `  gone: ${each.gone.why}`}`,
				),
			].join("\n"),
		);
		return;
	}
	const listed = held.filter((each) => each.removedAt === null);
	deps.log.info(
		[
			`this conversation holds ${listed.length} artifact${listed.length === 1 ? "" : "s"}`,
			...listed.map((each) => {
				const current = each.versions.find(
					(version) => version.version === each.current,
				);
				return `  ${each.name}  v${each.current} of ${each.versions.length}  ${current?.mimeType ?? ""}  ${megabytes(current?.bytes ?? 0)}`;
			}),
		].join("\n"),
	);
}

/** What the log of conversation `id` says its artifacts are. */
async function read(deps: ArtifactDeps, id: string): Promise<Artifact[]> {
	const replayed = await logOf(deps, id).replay();
	return replayed?.state.artifacts ?? [];
}

function logOf({ service, fs }: ArtifactDeps, id: string): ConversationLog {
	return new ConversationLog(
		service.conversationLog(id),
		fs,
		new SystemTimer(),
	);
}

/** The store over conversation `id`'s log, for a process that is not `arbor dev`. */
async function open(deps: ArtifactDeps, id: string): Promise<Artifacts> {
	const log = logOf(deps, id);
	const held = (await log.replay())?.state.artifacts ?? [];
	return new Artifacts(log.path, {
		fs: deps.fs,
		now: () => new Date().toISOString(),
		limits: artifactLimits(deps.service.config),
		held: () => held,
		record: async (change) => {
			log.write({ kind: "artifact", change });
			await log.flush();
			applyArtifact(held, change);
		},
	});
}

/** The server's answer to an add, or null when none could be reached. */
async function serverAdd(
	deps: ArtifactDeps,
	url: string,
	id: string,
	file: { name: string; bytes: Uint8Array; mimeType: string },
): Promise<ArtifactVersion | null> {
	const form = new FormData();
	form.set("name", file.name);
	form.set("mimeType", file.mimeType);
	form.set(
		"file",
		new File([file.bytes as Uint8Array<ArrayBuffer>], file.name),
	);
	const response = await (deps.send ?? fetch)(
		`${url}/api/conversations/${id}/artifacts`,
		{ method: "POST", headers: { origin: url }, body: form },
	).catch(() => null);
	return response === null
		? null
		: ((await answer(response)) as ArtifactVersion);
}

/** Whether the server removed it; false when none could be reached. */
async function serverRemove(
	deps: ArtifactDeps,
	url: string,
	id: string,
	name: string,
): Promise<boolean> {
	const response = await (deps.send ?? fetch)(
		`${url}/api/conversations/${id}/artifacts/${encodeURIComponent(name)}`,
		{ method: "DELETE", headers: { origin: url } },
	).catch(() => null);
	if (response === null) {
		return false;
	}
	await answer(response);
	return true;
}

/** The body of a good response, else the refusal the server gave, as this process would. */
async function answer(response: Response): Promise<unknown> {
	if (response.ok) {
		return response.json();
	}
	const refused = (await response.json().catch(() => ({}))) as {
		reason?: string;
		message?: string;
	};
	const reason = refused.reason as Reason;
	fail(
		reason in EXIT ? reason : "not_found",
		refused.message ?? `arbor dev refused it: ${response.status}`,
	);
}

/** The media types an agent's outputs most often are, by extension. */
const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".htm": "text/html",
	".md": "text/markdown",
	".txt": "text/plain",
	".css": "text/css",
	".csv": "text/csv",
	".js": "text/javascript",
	".json": "application/json",
	".pdf": "application/pdf",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
};

/** The media type `name`'s extension says, else plain bytes. */
export function mimeTypeOf(name: string): string {
	return MIME_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}

function megabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
