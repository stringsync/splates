import type { Document } from "../storage";

/** The file's own format. */
const FORMAT = 1;

/** How long an error counts toward avoiding its model, and how long a model is then avoided, in ms. */
export const AVOID_FOR = 30 * 60_000;

/** Errors of one model within `AVOID_FOR` that avoid it on their own. */
export const AVOID_AFTER = 3;

/** How long an error is kept, in ms, so the page can count a day of them. */
const KEPT = 24 * 3_600_000;

/** One failure of the provider, not of the work, that ended a run. */
export interface ProviderError {
	agent: string;
	/** The model the run was on, by the agent's own value; null for its default. */
	model: string | null;
	at: string;
	/** The HTTP status when the message gives one. */
	status: number | null;
	message: string;
}

/** A model Auto pick passes over for now, and why. */
export interface Avoided {
	agent: string;
	model: string | null;
	/** Provider errors in the last half hour. */
	errors: number;
	/** The newest of them, for the page to show. */
	last: ProviderError;
	/** What the provider's status page says is wrong; null when it says nothing or has none. */
	incident: string | null;
	/** When it is tried again: half an hour after its newest error. */
	until: string;
}

/** What a provider's status page says is wrong, by agent id; null for none. */
export interface IncidentSource {
	/** What `agent`'s status page says is wrong; null for nothing, or no page. */
	(agent: string): Promise<string | null>;
}
export type Incidents = IncidentSource;

/**
 * The provider errors runs hit, across projects, kept under the user's
 * home: a model with several lately, or one error while its status page
 * names an incident, is passed over by Auto pick for half an hour.
 */
export class Health {
	constructor(
		/** `~/.splates/health.json`, or a test's own. */
		private readonly doc: Document<{
			format?: number;
			errors?: ProviderError[];
			/** When each model was set to be tried again by the person, by `agent/model`. */
			cleared?: Record<string, string>;
		}>,
		private readonly incidents: Incidents = async () => null,
	) {}

	/** Keeps what a run's failed turn said, `error`, when it is the provider failing; a day-old error is dropped. */
	async hear(
		agent: string,
		model: string | null,
		at: string,
		message: string,
	): Promise<void> {
		const fault = providerFault(message);
		if (fault !== null) {
			await this.record({
				agent,
				model,
				at,
				status: fault.status,
				message: message.slice(0, 300),
			});
		}
	}

	/** Keeps `error`, dropping what is a day old. */
	async record(error: ProviderError): Promise<void> {
		await this.doc.update((current) => {
			const kept = (current?.errors ?? []).filter(
				(each) => Date.parse(error.at) - Date.parse(each.at) < KEPT,
			);
			return { ...current, format: FORMAT, errors: [...kept, error] };
		});
	}

	/** Every error kept, oldest first. */
	async errors(): Promise<ProviderError[]> {
		return (await this.read())?.errors ?? [];
	}

	/** The models Auto pick passes over at `now`, most errors first. */
	async avoided(now: Date): Promise<Avoided[]> {
		const read = await this.read();
		const since = now.getTime() - AVOID_FOR;
		const groups = new Map<string, ProviderError[]>();
		for (const error of read?.errors ?? []) {
			const cleared = read?.cleared?.[keyOf(error.agent, error.model)];
			if (
				Date.parse(error.at) < since ||
				(cleared !== undefined && error.at <= cleared)
			) {
				continue;
			}
			const key = keyOf(error.agent, error.model);
			groups.set(key, [...(groups.get(key) ?? []), error]);
		}
		const found = await Promise.all(
			[...groups.values()].map(async (errors): Promise<Avoided | null> => {
				const last = errors.reduce((older, newer) =>
					newer.at > older.at ? newer : older,
				);
				const incident = await this.incidents(last.agent).catch(() => null);
				if (errors.length < AVOID_AFTER && incident === null) {
					return null;
				}
				return {
					agent: last.agent,
					model: last.model,
					errors: errors.length,
					last,
					incident,
					until: new Date(Date.parse(last.at) + AVOID_FOR).toISOString(),
				};
			}),
		);
		return found
			.filter((each): each is Avoided => each !== null)
			.toSorted((one, other) => other.errors - one.errors);
	}

	/** Forgets the errors of `agent` on `model` up to `now`, so it is tried at once: "Use anyway". */
	async clear(agent: string, model: string | null, now: Date): Promise<void> {
		await this.doc.update((current) => ({
			...current,
			format: FORMAT,
			cleared: {
				...current?.cleared,
				[keyOf(agent, model)]: now.toISOString(),
			},
		}));
	}

	private async read(): Promise<{
		errors?: ProviderError[];
		cleared?: Record<string, string>;
	} | null> {
		try {
			const parsed = await this.doc.read();
			return (parsed?.format ?? FORMAT) > FORMAT ? null : parsed;
		} catch {
			return null;
		}
	}
}

function keyOf(agent: string, model: string | null): string {
	return `${agent}/${model ?? ""}`;
}

/** The error in `message` when it is the provider failing (a 5xx, overloaded), else null. */
export function providerFault(
	message: string,
): { status: number | null } | null {
	// A spent plan or cap is not a fault: those are limits, said elsewhere.
	if (/usage limit|limit reached|quota|rate.?limit/i.test(message)) {
		return null;
	}
	const status = /(?:status|http|error|code)\D{0,12}\b(5\d\d)\b/i.exec(message);
	const words =
		/overloaded|service unavailable|internal server error|bad gateway|gateway time-?out|api_error/i.test(
			message,
		);
	if (status === null && !words) {
		return null;
	}
	return { status: status === null ? null : Number(status[1]) };
}

/** Whether `error` is of `model`, a pick's model: an agent's default matches an error with none or `default`. */
function same(error: ProviderError, model: string | undefined): boolean {
	return model === undefined
		? error.model === null || error.model === "default"
		: error.model === model;
}

/** The entry of `avoided` for `agent` on `model`, a pick's model, or undefined. */
export function avoidedBy(
	avoided: readonly Avoided[],
	agent: string,
	model: string | undefined,
): Avoided | undefined {
	return avoided.find((each) => each.agent === agent && same(each.last, model));
}

/**
 * Reads what Claude's status page says is wrong: the name of an unresolved
 * incident, or null when none, for any other agent, or when the page cannot
 * be read. Pass it to `Health` as its incident source.
 */
export function statusPage(
	fetcher: (url: string, init: { signal: AbortSignal }) => Promise<Response> = (
		url,
		init,
	) => fetch(url, init),
	now: () => number = Date.now,
): Incidents {
	const urls: Record<string, string> = {
		claude: "https://status.claude.com/api/v2/summary.json",
	};
	const kept = new Map<string, { at: number; incident: string | null }>();
	return async (agent) => {
		const url = urls[agent];
		if (url === undefined) {
			return null;
		}
		const had = kept.get(agent);
		if (had !== undefined && now() - had.at < 5 * 60_000) {
			return had.incident;
		}
		let incident: string | null = null;
		try {
			const response = await fetcher(url, {
				signal: AbortSignal.timeout(3000),
			});
			const page = (await response.json()) as {
				incidents?: { name?: string; status?: string }[];
			};
			incident =
				page.incidents?.find((each) => each.status !== "resolved")?.name ??
				null;
		} catch {
			incident = null;
		}
		kept.set(agent, { at: now(), incident });
		return incident;
	};
}
