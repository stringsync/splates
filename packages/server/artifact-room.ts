import type { Fs } from "webappwiz/system";
import {
	type Artifact,
	type Artifacts,
	type ArtifactVersion,
	projectBytes,
	shown,
	tooLarge,
} from "./artifacts";

/**
 * Room for artifacts across a project, which every conversation's store
 * makes its adds through, one at a time. An add past the project's capacity
 * first evicts the bytes of other versions, in `evictionOrder`, keeping
 * their records as placeholders; when even all of them would not make room,
 * it is refused and nothing goes. Files attached to conversations count
 * toward the capacity but are never evicted: they serve the questions that
 * show them.
 */
export class ArtifactRoom {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly deps: {
			fs: Fs;
			/** Where every conversation of the project keeps its files. */
			dir: string;
			/** How many bytes every conversation may keep together. */
			capacity: number;
			/** Every conversation's store, and whether it is archived. */
			shelves: () => ArtifactShelf[];
		},
	) {}

	/** Runs `work` once every add before it has finished. */
	hold<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work);
		this.queue = next.catch(() => {});
		return next;
	}

	/**
	 * Evicts what it must for `bytes` more of the artifact `name` to fit, or
	 * refuses `too_large`, evicting nothing, when it cannot.
	 */
	async make(bytes: number, name: string): Promise<void> {
		const { fs, dir, capacity } = this.deps;
		const project = (await projectBytes(fs, dir)) + bytes;
		let needed = project - capacity;
		if (needed <= 0) {
			return;
		}
		const order = evictionOrder(this.deps.shelves());
		const evictable = order.reduce((sum, each) => sum + each.version.bytes, 0);
		if (evictable < needed) {
			tooLarge("the project", name, project, capacity);
		}
		for (const { store, name, version } of order) {
			if (needed <= 0) {
				break;
			}
			await store.delete(name, version.version, "evicted");
			needed -= version.bytes;
		}
	}
}

/** One conversation's store, as the room sees it. */
export interface ArtifactShelf {
	store: Artifacts;
	archived: boolean;
}

/**
 * Every version whose bytes are kept, in the order eviction takes them:
 * removed and superseded ones of any conversation first, then the shown ones
 * of archived conversations, then those of live ones; oldest first within
 * each.
 */
export function evictionOrder(
	shelves: ArtifactShelf[],
): { store: Artifacts; name: string; version: ArtifactVersion }[] {
	const rank = (
		shelf: ArtifactShelf,
		artifact: Artifact,
		version: ArtifactVersion,
	) => (!shown(artifact, version) ? 0 : shelf.archived ? 1 : 2);
	return shelves
		.flatMap((shelf) =>
			shelf.store.held.flatMap((artifact) =>
				artifact.versions
					.filter((version) => version.gone === null)
					.map((version) => ({
						store: shelf.store,
						name: artifact.name,
						version,
						rank: rank(shelf, artifact, version),
					})),
			),
		)
		.sort(
			(one, other) =>
				one.rank - other.rank ||
				one.version.addedAt.localeCompare(other.version.addedAt),
		)
		.map(({ rank: _, ...each }) => each);
}
