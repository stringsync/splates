import { basename, dirname, resolve } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs } from "webappwiz/system";
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
		},
	) {
		this.dir = `${resolve(log.replace(/\.jsonl$/, ""))}/artifacts`;
		this.conversations = dirname(resolve(log));
		this.ids = deps.ids ?? new UuidProvider();
	}

	/**
	 * Keeps `file` as the next version of the artifact named for it, listing
	 * it again if it was removed. Refuses one past any limit `too_large`,
	 * changing nothing.
	 */
	add(file: ArtifactFile): Promise<ArtifactVersion> {
		return this.serially(async () => {
			const name = file.name.trim();
			if (name === "") {
				fail("usage", "an artifact needs a name: nothing was changed");
			}
			const size = file.bytes.length;
			const { limits } = this.deps;
			const refuse = (what: string, bytes: number, capacity: number) =>
				fail(
					"too_large",
					`that would have ${what} hold ${megabytes(bytes)} of artifacts, past its ${megabytes(capacity)}: nothing was changed`,
					{ name, bytes, capacity },
				);
			if (size > limits.file) {
				fail(
					"too_large",
					`'${name}' is ${megabytes(size)}, past the ${megabytes(limits.file)} an artifact may be: nothing was changed`,
					{ name, bytes: size, capacity: limits.file },
				);
			}
			const conversation = kept(this.deps.held()) + size;
			if (conversation > limits.conversation) {
				refuse("this conversation", conversation, limits.conversation);
			}
			const project = (await this.projectBytes()) + size;
			if (project > limits.project) {
				refuse("the project", project, limits.project);
			}
			const stored = `${this.ids.next()}-${safe(name)}`;
			await this.deps.fs.mkdir(this.dir);
			await this.deps.fs.writeBytes(`${this.dir}/${stored}`, file.bytes);
			await this.deps.record({
				type: "add",
				name,
				file: stored,
				mimeType: file.mimeType,
				bytes: size,
				addedAt: this.deps.now(),
			});
			const added = this.find(name);
			return added.versions[added.versions.length - 1] as ArtifactVersion;
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
			if (kept.gone !== null) {
				return;
			}
			await this.deps.fs.rm(`${this.dir}/${kept.file}`, { force: true });
			await this.deps.record({
				type: "gone",
				name,
				version,
				at: this.deps.now(),
				why,
			});
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

	/** How many bytes of artifacts every conversation in the project keeps, read from disk. */
	private async projectBytes(): Promise<number> {
		const { fs } = this.deps;
		let total = 0;
		const entries = await fs.readdir(this.conversations).catch(() => []);
		for (const entry of entries) {
			const dir = `${this.conversations}/${entry}/artifacts`;
			for (const file of await fs.readdir(dir).catch(() => [])) {
				total += (await fs.stat(`${dir}/${file}`)).size;
			}
		}
		return total;
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

/** A stored name kept to letters, digits, dots and dashes, as `attach` keeps its own. */
function safe(name: string): string {
	return basename(name).replace(/[^\w.-]+/g, "-") || "artifact";
}

function megabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
