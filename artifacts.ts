import { basename, dirname, resolve } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs } from "webappwiz/system";
import type { ArtifactRoom } from "./artifact-room";
import { folderBytes } from "./attachments";
import type { Config } from "./config";
import { fail } from "./exit";

/**
 * A conversation's artifacts: their bytes, in `artifacts/` beside its log's
 * other files, and their record, `held`, which each change goes to through
 * `record` (the log, then the state) once its bytes are in place. One change
 * at a time, so two adds of one name never take the same version.
 */
export class Artifacts {
	/** Where the bytes are kept. */
	readonly dir: string;
	/** Where every conversation of the project keeps its files. */
	private readonly conversations: string;
	private readonly ids: IdProvider;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		/** The conversation's log, whose files directory holds the artifacts. */
		log: string,
		private readonly deps: {
			fs: Fs;
			now: () => string;
			limits: ArtifactLimits;
			ids?: IdProvider;
			/** The record as it stands. */
			held: () => Artifact[];
			/** Keeps `change`, folding it into `held`. */
			record: (change: ArtifactChange) => Promise<void>;
			/**
			 * The project's room, which evicts what other versions it must
			 * for an add past the project's capacity; without it, as for a
			 * CLI that reaches no `arbor dev`, such an add is refused.
			 */
			room?: ArtifactRoom;
		},
	) {
		this.dir = `${resolve(log.replace(/\.jsonl$/, ""))}/artifacts`;
		this.conversations = dirname(resolve(log));
		this.ids = deps.ids ?? new UuidProvider();
	}

	/** The record as it stands. */
	get held(): Artifact[] {
		return this.deps.held();
	}

	/**
	 * Keeps `file` as the next version of the artifact named for it, listing
	 * it again if it was removed. Past the project's capacity, its room evicts
	 * what it can first; refuses one past any limit still `too_large`,
	 * changing nothing.
	 */
	add(file: ArtifactFile): Promise<ArtifactVersion> {
		const { room } = this.deps;
		if (room === undefined) {
			return this.serially(async () => {
				const size = await this.admit(file);
				// With no room to make it, nothing another conversation keeps can go.
				const { fs, limits } = this.deps;
				const project = (await projectBytes(fs, this.conversations)) + size;
				if (project > limits.project) {
					tooLarge("the project", file.name.trim(), project, limits.project);
				}
				return this.keep(file);
			});
		}
		// Every add of the project takes its turn, so two never evict for each
		// other; this store's own queue waits until the room is made, since
		// making it can delete from this store too.
		return room.hold(async () => {
			await room.make(await this.admit(file), file.name.trim());
			return this.serially(() => this.keep(file));
		});
	}

	/** Marks the artifact `name` removed, keeping every version's bytes for cleanup. */
	remove(name: string): Promise<void> {
		return this.serially(async () => {
			const artifact = this.find(name);
			if (artifact.removedAt !== null) {
				fail("not_found", `artifact '${name}' is already removed`, { name });
			}
			await this.deps.record({ type: "remove", name, at: this.deps.now() });
		});
	}

	/**
	 * Deletes the bytes of `version` of the artifact `name`, saying `why`,
	 * and keeps its record, so it shows as a placeholder.
	 */
	delete(name: string, version: number, why: ArtifactGone): Promise<void> {
		return this.serially(async () => {
			const kept = this.find(name).versions.find(
				(each) => each.version === version,
			);
			if (kept === undefined) {
				fail("not_found", `artifact '${name}' has no version ${version}`, {
					name,
					version,
				});
			}
			if (kept.gone === null) {
				await this.drop(name, kept, why);
			}
		});
	}

	/**
	 * Deletes the bytes of every version no longer shown, those of removed
	 * artifacts and those a later one superseded, as its conversation is
	 * archived: what stays is what its panel still lists.
	 */
	archive(): Promise<void> {
		return this.serially(async () => {
			for (const artifact of this.deps.held()) {
				for (const version of artifact.versions) {
					if (version.gone === null && !shown(artifact, version)) {
						await this.drop(artifact.name, version, "archived");
					}
				}
			}
		});
	}

	/**
	 * The bytes and media type of `version` of the artifact `name`, its
	 * current one by default; null when there is no such version or its
	 * bytes are gone.
	 */
	async read(
		name: string,
		version?: number,
	): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
		const artifact = this.deps.held().find((each) => each.name === name);
		const wanted = version ?? artifact?.current;
		const kept = artifact?.versions.find((each) => each.version === wanted);
		if (kept === undefined || kept.gone !== null) {
			return null;
		}
		const bytes = await this.deps.fs
			.readBytes(`${this.dir}/${kept.file}`)
			.catch(() => null);
		return bytes === null ? null : { bytes, mimeType: kept.mimeType };
	}

	/**
	 * Refuses `file` when it has no name, or when it or this conversation
	 * would pass its limit; its size when it fits.
	 */
	private async admit(file: ArtifactFile): Promise<number> {
		const name = file.name.trim();
		if (name === "") {
			fail("usage", "an artifact needs a name: nothing was changed");
		}
		const size = file.bytes.length;
		const { limits } = this.deps;
		if (size > limits.file) {
			fail(
				"too_large",
				`'${name}' is ${megabytes(size)}, past the ${megabytes(limits.file)} an artifact may be: nothing was changed`,
				{ name, bytes: size, capacity: limits.file },
			);
		}
		// Files attached to the conversation count toward its capacity too.
		const attached = await folderBytes(
			this.deps.fs,
			`${dirname(this.dir)}/attached`,
		);
		const conversation = kept(this.deps.held()) + attached + size;
		if (conversation > limits.conversation) {
			tooLarge("this conversation", name, conversation, limits.conversation);
		}
		return size;
	}

	/** Writes `file`'s bytes and records them as its name's next version. */
	private async keep(file: ArtifactFile): Promise<ArtifactVersion> {
		const name = file.name.trim();
		const stored = `${this.ids.next()}-${safe(name)}`;
		await this.deps.fs.mkdir(this.dir);
		await this.deps.fs.writeBytes(`${this.dir}/${stored}`, file.bytes);
		await this.deps.record({
			type: "add",
			name,
			file: stored,
			mimeType: file.mimeType,
			bytes: file.bytes.length,
			addedAt: this.deps.now(),
		});
		const added = this.find(name);
		return added.versions[added.versions.length - 1] as ArtifactVersion;
	}

	/** Deletes `version`'s bytes and records that they went, and why. */
	private async drop(
		name: string,
		version: ArtifactVersion,
		why: ArtifactGone,
	): Promise<void> {
		await this.deps.fs.rm(`${this.dir}/${version.file}`, { force: true });
		await this.deps.record({
			type: "gone",
			name,
			version: version.version,
			at: this.deps.now(),
			why,
		});
	}

	/** The artifact `name`, refusing `not_found` when there is none. */
	private find(name: string): Artifact {
		const artifact = this.deps.held().find((each) => each.name === name);
		if (artifact === undefined) {
			fail("not_found", `this conversation holds no artifact '${name}'`, {
				name,
			});
		}
		return artifact;
	}

	private serially<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work);
		this.queue = next.catch(() => {});
		return next;
	}
}

/**
 * A file an agent made as an output of its conversation, such as a
 * screenshot, a recording or an HTML page, kept by name for the life of the
 * conversation, whatever task it was made in. Adding the name again makes its
 * next version. Its record stays for good, so one whose bytes went still
 * shows as a placeholder.
 */
export interface Artifact {
	name: string;
	/** The `version` of the one shown; the newest, as added. */
	current: number;
	/** Every version, oldest first, numbered from 1. */
	versions: ArtifactVersion[];
	/** When it was removed, its versions kept until cleanup takes them; null while listed. */
	removedAt: string | null;
}

/** One version of an artifact: what was added under its name at once. */
export interface ArtifactVersion {
	version: number;
	/** Its file in the conversation's artifacts directory, named so none collide. */
	file: string;
	mimeType: string;
	/** Its size. */
	bytes: number;
	addedAt: string;
	/** When and why its bytes were deleted, its record kept; null while they are kept. */
	gone: { at: string; why: ArtifactGone } | null;
}

/**
 * Why a version's bytes went: its conversation was archived, the project ran
 * past its cap, or the person deleted it.
 */
export type ArtifactGone = "archived" | "evicted" | "deleted";

/** A change to a conversation's artifacts, as its log keeps it. */
export type ArtifactChange =
	| ({ type: "add"; name: string } & Omit<ArtifactVersion, "version" | "gone">)
	| { type: "remove"; name: string; at: string }
	| {
			type: "gone";
			name: string;
			version: number;
			at: string;
			why: ArtifactGone;
	  };

/** A file to keep as an artifact, as the agent hands it over. */
export interface ArtifactFile {
	name: string;
	mimeType: string;
	bytes: Uint8Array;
}

/** How many bytes artifacts may take, each past which an add is refused. */
export interface ArtifactLimits {
	/** One file. */
	file: number;
	/** Every version one conversation keeps the bytes of. */
	conversation: number;
	/** Every version every conversation in the project keeps the bytes of. */
	project: number;
}

/** What `arbor.config.ts` leaves the limits at unless it says otherwise. */
export const ARTIFACT_LIMITS: ArtifactLimits = {
	file: 50 * 1024 * 1024,
	conversation: 250 * 1024 * 1024,
	project: 2 * 1024 * 1024 * 1024,
};

/** The limits `config` sets. */
export function artifactLimits(
	config: Pick<
		Config,
		| "artifactFileCapacity"
		| "artifactConversationCapacity"
		| "artifactProjectCapacity"
	>,
): ArtifactLimits {
	return {
		file: config.artifactFileCapacity,
		conversation: config.artifactConversationCapacity,
		project: config.artifactProjectCapacity,
	};
}

/** Folds `change` into `artifacts`, as live and as a log is read back. */
export function applyArtifact(
	artifacts: Artifact[],
	change: ArtifactChange,
): void {
	const artifact = artifacts.find((each) => each.name === change.name);
	if (change.type === "add") {
		const { type: _, name, ...added } = change;
		const version = (artifact?.versions.length ?? 0) + 1;
		const kept: ArtifactVersion = { version, ...added, gone: null };
		if (artifact === undefined) {
			artifacts.push({
				name,
				current: version,
				versions: [kept],
				removedAt: null,
			});
		} else {
			artifact.versions.push(kept);
			artifact.current = version;
			artifact.removedAt = null;
		}
	} else if (change.type === "remove") {
		if (artifact !== undefined) {
			artifact.removedAt = change.at;
		}
	} else {
		const version = artifact?.versions.find(
			(each) => each.version === change.version,
		);
		if (version !== undefined) {
			version.gone = { at: change.at, why: change.why };
		}
	}
}

/** The bytes `artifacts` keep, every version whose bytes have not gone. */
function kept(artifacts: Artifact[]): number {
	return artifacts
		.flatMap((each) => each.versions)
		.filter((each) => each.gone === null)
		.reduce((sum, each) => sum + each.bytes, 0);
}

/** Whether `version` is the one its artifact's panel shows: its current, while listed. */
export function shown(artifact: Artifact, version: ArtifactVersion): boolean {
	return artifact.removedAt === null && version.version === artifact.current;
}

/**
 * How many bytes every conversation under `dir` keeps, read from disk: its
 * artifacts' and the files attached to it.
 */
export async function projectBytes(fs: Fs, dir: string): Promise<number> {
	let total = 0;
	for (const entry of await fs.readdir(dir).catch(() => [])) {
		total += await folderBytes(fs, `${dir}/${entry}/artifacts`);
		total += await folderBytes(fs, `${dir}/${entry}/attached`);
	}
	return total;
}

/** Refuses an add that would have `what` hold `bytes`, past its `capacity`. */
export function tooLarge(
	what: string,
	name: string,
	bytes: number,
	capacity: number,
): never {
	fail(
		"too_large",
		`that would have ${what} hold ${megabytes(bytes)} of artifacts, past its ${megabytes(capacity)}: nothing was changed`,
		{ name, bytes, capacity },
	);
}

/** A stored name kept to letters, digits, dots and dashes, as `attach` keeps its own. */
function safe(name: string): string {
	return basename(name).replace(/[^\w.-]+/g, "-") || "artifact";
}

function megabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
