import { fail } from "../exit";
import type { Document } from "../storage";
import type { SignalClock } from "./clock-schedule";
import { RETENTION_MS, type SignalProbe, type SignalRaise } from "./types";

/** `signals.json`: each signal's raises of the last week, oldest first, and its probe. */
interface File {
	clocks?: Record<string, SignalClock>;
	raises: Record<string, SignalRaise[]>;
	expirations?: Record<string, string>;
	/** Signals that remove themselves once fired. */
	once?: string[];
	removed?: string[];
	/** Signal functions that have supplied waits, for restart reconciliation. */
	families?: string[];
	/** Each signal's probe, on or ended in the last week. */
	probes?: Record<string, SignalProbe>;
}

/**
 * Keeps signal history for waits that reach back to an earlier raise. Call
 * raise to record a fact and after to find a matching fact from the last week.
 */
export class SignalBook {
	constructor(
		private readonly file: Document<File>,
		private readonly now: () => number,
	) {}

	/** Optional removal deadlines, persisted across restarts. */
	async expirations(): Promise<Record<string, string>> {
		return (await this.file.read())?.expirations ?? {};
	}

	/** Signals set to expire as soon as they fire. */
	async once(): Promise<string[]> {
		return (await this.file.read())?.once ?? [];
	}

	/** Marks or unmarks a signal as one-off: it expires once fired. */
	async expireOnFire(name: string, on: boolean): Promise<void> {
		await this.file.update((current) => {
			const rest = (current?.once ?? []).filter((each) => each !== name);
			return {
				...current,
				raises: current?.raises ?? {},
				once: on ? [...rest, name] : rest,
			};
		});
	}

	/** Signals removed by expiration, hidden until raised again. */
	async removed(): Promise<string[]> {
		return (await this.file.read())?.removed ?? [];
	}

	/** Sets or clears a signal's removal deadline. */
	async expireAt(name: string, at: string | null): Promise<void> {
		await this.file.update((current) => {
			const expirations = { ...current?.expirations };
			if (at === null) {
				delete expirations[name];
			} else {
				expirations[name] = at;
			}
			return { ...current, raises: current?.raises ?? {}, expirations };
		});
	}

	/** Forgets the expired signal after its subscriptions have ended. */
	async forget(name: string): Promise<void> {
		await this.file.update((current) => {
			const raises = { ...current?.raises };
			const clocks = { ...current?.clocks };
			const probes = { ...current?.probes };
			const expirations = { ...current?.expirations };
			for (const key of Object.keys(raises)) {
				if (dotted(key) === name) {
					delete raises[key];
				}
			}
			delete probes[name];
			delete clocks[name];
			delete expirations[name];
			return {
				...current,
				once: (current?.once ?? []).filter((each) => each !== name),
				raises,
				probes,
				clocks,
				expirations,
				removed: [...new Set([...(current?.removed ?? []), name])],
			};
		});
	}

	/** Records a signal function used by a wait so startup can check whether it was undeclared. */
	async watchSignalFunction(fn: string): Promise<void> {
		await this.file.update((current) => ({
			...current,
			raises: current?.raises ?? {},
			families: [...new Set([...(current?.families ?? []), fn])],
		}));
	}

	/** Whether any signal function waits need configuration reconciliation on restart. */
	async hasSignalFunctionWaits(): Promise<boolean> {
		return ((await this.file.read())?.families?.length ?? 0) > 0;
	}

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
			return {
				...current,
				raises,
				removed: current?.removed?.filter((each) => each !== name),
			};
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

	/** Durable clocks, including finished one-shot schedules. */
	async clocks(): Promise<SignalClock[]> {
		return Object.values((await this.file.read())?.clocks ?? {});
	}
	async keepClock(clock: SignalClock): Promise<void> {
		await this.file.update((current) => ({
			...current,
			raises: current?.raises ?? {},
			clocks: { ...current?.clocks, [clock.name]: clock },
		}));
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
			return { ...current, raises: current?.raises ?? {}, probes };
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

/** Normalizes a signal name for lookup, converting slash separators to dots. */
export function dotted(name: string): string {
	const text = name.trim();
	const open = text.indexOf("(");
	return open < 0
		? text.replaceAll("/", ".")
		: text.slice(0, open).replaceAll("/", ".") + text.slice(open);
}

/** The slug of the project a signal belongs to: what comes before its first dot. */
export function projectOf(name: string): string {
	return dotted(name).split(".")[0] ?? "";
}

/** Validates a signal name such as mdom.released, refusing malformed names. */
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
