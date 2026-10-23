import type { Fs, Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import { MACHINE_HOME } from "../ports";

/**
 * How long the person's approval of a whole-suite run stands before it is
 * used: long enough for the agent to finish its turn and start the run.
 */
export const SUITE_GRANT_MS = 60 * 60 * 1000;

/**
 * The person's approvals of an agent running the whole test suite outside a
 * merge's gate, one file a conversation under the machine's splates home,
 * each holding when it stops standing. Each lets one run start.
 */
export class SuiteGrants {
	readonly #fs: Fs;
	readonly #dir: string;
	readonly #now: () => number;

	constructor({
		fs,
		ps,
		now = Date.now,
	}: {
		fs: Fs;
		ps: Ps;
		now?: () => number;
	}) {
		this.#fs = fs;
		this.#dir = `${ps.env(MACHINE_HOME) ?? splatesHome(ps)}/suite-grants`;
		this.#now = now;
	}

	/** Lets `conversation` run the whole suite once, within `SUITE_GRANT_MS`. */
	async grant(conversation: string): Promise<void> {
		await this.#fs.mkdir(this.#dir, { recursive: true });
		await this.#fs.write(
			this.#path(conversation),
			String(this.#now() + SUITE_GRANT_MS),
		);
	}

	/**
	 * Whether `conversation` had an approval standing, which this uses up: two
	 * runs that ask at once never both have it.
	 */
	async take(conversation: string): Promise<boolean> {
		const path = this.#path(conversation);
		const taken = `${path}.${crypto.randomUUID()}`;
		const moved = await this.#fs
			.rename(path, taken)
			.then(() => true)
			.catch(() => false);
		if (!moved) {
			return false;
		}
		const until = Number(await this.#fs.read(taken).catch(() => "0"));
		await this.#fs.rm(taken, { force: true });
		return until > this.#now();
	}

	#path(conversation: string): string {
		return `${this.#dir}/${encodeURIComponent(conversation)}`;
	}
}
