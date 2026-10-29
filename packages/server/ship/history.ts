import type { Fs } from "webappwiz/system";
import type { Storage } from "../storage";
import type { Cascade } from "./cascade";
import { STAGE_DEFAULTS, type StageKey, type StageLog, took } from "./stages";

/** Where the machine's records keep the cascades of ships, each under its id. */
const HISTORY = "ship-history";

/** How many cascades history keeps, the one under way among them. */
export const KEPT = 20;

/** How many ships before a step's expected time is taken from. */
const LATELY = 5;

/** What a cascade is in the history list, without its steps. */
export interface CascadeSummary {
	id: string;
	from: string;
	status: Cascade["status"];
	started: string;
	ended: string | null;
	/** Each project in it and where it stands, in dependency order. */
	projects: { slug: string; status: string }[];
}

/** The ships the machine ran lately, the last {@link KEPT} of them with their steps and logs, for the page to list and open. */
export class ShipHistory {
	constructor(
		private readonly storage: Storage,
		private readonly fs: Fs,
	) {}

	/** Keeps `cascade` as it stands now. */
	async file(cascade: Cascade): Promise<void> {
		await this.storage
			.document<Cascade>(`${HISTORY}/${cascade.id}/cascade.json`)
			.write(cascade);
	}

	/** The cascade `id` names, or null when history has none. */
	read(id: string): Promise<Cascade | null> {
		if (!/^[\w][\w.+-]*$/.test(id)) {
			return Promise.resolve(null);
		}
		return this.storage
			.document<Cascade>(`${HISTORY}/${id}/cascade.json`)
			.read();
	}

	/** Every cascade kept, newest first. */
	async list(): Promise<Cascade[]> {
		const ids = (await this.ids()).reverse();
		const read = await Promise.all(ids.map((id) => this.read(id)));
		return read.filter((each): each is Cascade => each !== null);
	}

	/** Every cascade kept, newest first, without its steps. */
	async summaries(): Promise<CascadeSummary[]> {
		return (await this.list()).map((cascade) => ({
			id: cascade.id,
			from: cascade.from,
			status: cascade.status,
			started: cascade.started,
			ended: cascade.ended,
			projects: cascade.steps.map((step) => ({
				slug: step.slug,
				status: step.status,
			})),
		}));
	}

	/** Where the ship log of `slug` in the cascade `id` is. */
	logOf(id: string, slug: string): string {
		return this.storage.locate(`${HISTORY}/${id}/${slug}.log`);
	}

	/** What the ship log of `slug` in the cascade `id` holds at `log`'s bytes, to its end while it prints. */
	async slice(id: string, slug: string, log: StageLog): Promise<string> {
		const path = this.logOf(id, slug);
		const bytes = (await this.fs.exists(path))
			? await this.fs.readBytes(path)
			: new Uint8Array(0);
		return new TextDecoder().decode(
			bytes.slice(log.from, log.to ?? bytes.byteLength),
		);
	}

	/** Drops all but the newest {@link KEPT} cascades, with their logs. */
	async prune(): Promise<void> {
		const ids = await this.ids();
		for (const id of ids.slice(0, Math.max(0, ids.length - KEPT))) {
			const dir = this.storage.locate(`${HISTORY}/${id}`);
			await this.storage.remove(`${HISTORY}/${id}`);
			await this.fs.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	}

	/**
	 * How long step `key` of `slug`'s part is expected to take: the mean of
	 * the last few times it was done, known, or else its default.
	 */
	async expected(
		slug: string,
		key: StageKey,
		kept?: Cascade[],
	): Promise<{ expected: number; known: boolean }> {
		const times: number[] = [];
		for (const cascade of kept ?? (await this.list())) {
			if (cascade.status === "running") {
				continue;
			}
			const stage = cascade.steps
				.find((step) => step.slug === slug)
				?.stages?.find((each) => each.key === key);
			const ms = stage === undefined ? null : took(stage);
			if (ms !== null) {
				times.push(ms);
			}
			if (times.length === LATELY) {
				break;
			}
		}
		return times.length === 0
			? { expected: STAGE_DEFAULTS[key].ms, known: false }
			: {
					expected: Math.round(
						times.reduce((sum, ms) => sum + ms, 0) / times.length,
					),
					known: true,
				};
	}

	/** The ids kept, oldest first, as their start sorts them. */
	private async ids(): Promise<string[]> {
		return (await this.storage.children(HISTORY).catch(() => [])).sort();
	}
}

/** The id a cascade from `from`, started at `started`, is kept under. */
export function cascadeId(from: string, started: string): string {
	return `${started.replace(/[:.]/g, "-")}-${from}`;
}
