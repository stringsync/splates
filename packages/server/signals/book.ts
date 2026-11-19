import { fail } from "../exit";
import type { Document } from "../storage";
import { RETENTION_MS, type SignalProbe, type SignalRaise } from "./types";

/** `signals.json`: each signal's raises of the last week, oldest first, and its probe. */
interface File {
	raises: Record<string, SignalRaise[]>;
	/** Each signal's probe, on or ended in the last week. */
	probes?: Record<string, SignalProbe>;
}

/**
 * Records each signal raised on this machine for a week, so a wait's
 * `--since` can read a raise from before it began. Read raises with `after`;
 * a signal is never a current truth, only what was raised and when.
 */
export class SignalBook {
	constructor(
		private readonly file: Document<File>,
		private readonly now: () => number,
	) {}

	/** Records a raise of `name`, forgetting raises older than a week. */
	async raise(
		name: string,
		by: string,
		payload: unknown,
	): Promise<SignalRaise> {
		const raise: SignalRaise = {
			at: new Date(this.now()).toISOString(),
			by,
			payload: payload ?? null,
		};
		const floor = new Date(this.now() - RETENTION_MS).toISOString();
		await this.file.update((current) => {
			const raises = { ...(current?.raises ?? {}) };
			for (const [each, list] of Object.entries(raises)) {
				const kept = list.filter((one) => one.at >= floor);
				if (kept.length === 0) {
					delete raises[each];
				} else {
					raises[each] = kept;
				}
			}
			raises[name] = [...(raises[name] ?? []), raise];
			return { ...current, raises };
		});
		return raise;
	}

	/** Every signal's raises of the last week, oldest first. */
	async raises(): Promise<Record<string, SignalRaise[]>> {
		const stored = (await this.file.read())?.raises ?? {};
		const raises: Record<string, SignalRaise[]> = {};
		for (const [each, list] of Object.entries(stored)) {
			const name = dotted(each);
			raises[name] = [...(raises[name] ?? []), ...list].sort((first, second) =>
				first.at.localeCompare(second.at),
			);
		}
		return raises;
	}

	/** Every probe kept, on or ended in the last week. */
	async probes(): Promise<SignalProbe[]> {
		return Object.values((await this.file.read())?.probes ?? {});
	}

	/** The probe on `name`, or null for none. */
	async probe(name: string): Promise<SignalProbe | null> {
		const probes = (await this.file.read())?.probes ?? {};
		return (
			Object.entries(probes).find(
				([each]) => dotted(each) === dotted(name),
			)?.[1] ?? null
		);
	}

	/** Keeps `probe` as its signal's one probe, forgetting probes that ended over a week ago. */
	async keepProbe(probe: SignalProbe): Promise<void> {
		const floor = new Date(this.now() - RETENTION_MS).toISOString();
		await this.file.update((current) => {
			const probes = { ...(current?.probes ?? {}) };
			for (const [each, one] of Object.entries(probes)) {
				if (one.endedAt !== undefined && one.endedAt < floor) {
					delete probes[each];
				}
			}
			probes[probe.name] = probe;
			return { raises: current?.raises ?? {}, probes };
		});
	}

	/**
	 * The newest raise of `name` after `since`, or null for none. A `since`
	 * further back than the book keeps is refused, rather than answered as
	 * nothing found.
	 */
	async after(name: string, since: string): Promise<SignalRaise | null> {
		const floor = this.now() - RETENTION_MS;
		if (Date.parse(since) < floor) {
			fail(
				"usage",
				`signals keep their raises for 7 days: '${since}' is further back`,
				{ since },
			);
		}
		const list = (await this.raises())[dotted(name)] ?? [];
		return list.findLast((one) => one.at > since) ?? null;
	}
}

/** A signal name in its dotted form: the older `mdom/released` becomes `mdom.released`. */
export function dotted(name: string): string {
	return name.trim().replaceAll("/", ".");
}

/** The slug of the project a signal belongs to: what comes before its first dot. */
export function projectOf(name: string): string {
	return dotted(name).split(".")[0] ?? "";
}

/**
 * A signal's name: `<project>.<name>`, dot-separated words of any depth, as
 * `mdom.released`. The older `<project>.<name>` is still read, as its dotted form.
 */
export function checkName(name: string): string {
	const text = dotted(name);
	if (!/^[\w-]+(\.[\w-]+)+$/.test(text)) {
		fail(
			"usage",
			`'${name}' is no signal name: write <project>.<name>, as mdom.released`,
			{ name },
		);
	}
	return text;
}
