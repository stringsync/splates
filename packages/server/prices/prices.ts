import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import type { Document, Storage } from "../storage";

/** Where the public API list prices come from: OpenCode prices models by it too. */
export const CATALOG = "https://models.dev/api.json";

/** How long a fetched catalog stands before it is fetched again. */
const FRESH = Duration.days(1);

const PATIENCE = Duration.secs(5);

/** Dollars per million tokens of each kind, at one context size and above. */
export interface Rate {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** A model's API list price, and the dearer tiers past a context size some models have. */
export interface Price extends Rate {
	/** The kinds of input the model takes (`text`, `image`); unsaid for a catalog fetched before they were kept. */
	inputs?: string[];
	tiers: (Rate & { context: number })[];
}

/** Each model's API list price, by `<provider>/<model>`. */
export type Catalog = Record<string, Price>;

interface Saved {
	fetchedAt: number;
	catalog: Catalog;
}

/** What one turn of an agent used, as it said at the turn's end. */
export interface TurnTokens {
	/** Tokens read fresh, those from cache apart. */
	input: number;
	cachedRead: number;
	cachedWrite: number;
	output: number;
	/** Tokens in the context window as the turn ended; null when unsaid. */
	context: number | null;
}

export interface PricesOptions {
	/** How the catalog is fetched; a test's stands in for the network. */
	fetcher?: typeof fetch;
	clock?: WallClock;
}

/**
 * The machine's copy of the API list price of every model, kept in
 * `~/.splates/prices.json` and fetched again once a day, so a merge
 * offline still prices its task at what it last heard.
 */
export class Prices {
	private readonly saved: Document<Saved>;
	private readonly fetcher: typeof fetch;
	private readonly clock: WallClock;

	constructor(storage: Storage, opts: PricesOptions = {}) {
		this.saved = storage.document("prices.json");
		this.fetcher = opts.fetcher ?? fetch;
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** The catalog, fetched again when stale; null when never heard and unreachable. */
	async catalog(): Promise<Catalog | null> {
		const saved = await this.saved.read().catch(() => null);
		if (saved !== null && this.clock.now() - saved.fetchedAt < FRESH.ms) {
			return saved.catalog;
		}
		const catalog = await this.fetchCatalog();
		if (catalog === null) {
			return saved?.catalog ?? null;
		}
		await this.saved
			.write({ fetchedAt: this.clock.now(), catalog })
			.catch(() => {});
		return catalog;
	}

	private async fetchCatalog(): Promise<Catalog | null> {
		try {
			const response = await this.fetcher(CATALOG, {
				signal: AbortSignal.timeout(PATIENCE.ms),
			});
			if (!response.ok) {
				return null;
			}
			const catalog = catalogOf(await response.json());
			return Object.keys(catalog).length === 0 ? null : catalog;
		} catch {
			return null;
		}
	}
}

/** The prices models.dev's `api.json` gives, each model's that says one. */
export function catalogOf(raw: unknown): Catalog {
	const catalog: Catalog = {};
	if (!isRecord(raw)) {
		return catalog;
	}
	for (const [provider, entry] of Object.entries(raw)) {
		const models = isRecord(entry) ? entry.models : null;
		if (!isRecord(models)) {
			continue;
		}
		for (const [model, about] of Object.entries(models)) {
			const cost = isRecord(about) ? about.cost : null;
			const base = rateOf(cost);
			if (base === null || !isRecord(cost)) {
				continue;
			}
			const tiers = Array.isArray(cost.tiers) ? cost.tiers : [];
			const modalities = isRecord(about) ? about.modalities : null;
			const inputs = isRecord(modalities) ? modalities.input : null;
			catalog[`${provider}/${model}`] = {
				...base,
				...(Array.isArray(inputs)
					? {
							inputs: inputs.filter(
								(each): each is string => typeof each === "string",
							),
						}
					: {}),
				tiers: tiers.flatMap((tier) => {
					const rate = rateOf(tier);
					const over = isRecord(tier) ? tier.tier : null;
					return rate !== null &&
						isRecord(over) &&
						over.type === "context" &&
						typeof over.size === "number"
						? [{ ...rate, context: over.size }]
						: [];
				}),
			};
		}
	}
	return catalog;
}

/**
 * Where `agent` running `model` is in the catalog: Codex runs OpenAI's
 * models, OpenCode names each by its provider already. Null for an agent
 * that says its own API cost, as Claude does.
 */
export function catalogKey(agent: string, model: string | null): string | null {
	if (model === null) {
		return null;
	}
	if (agent === "codex") {
		return `openai/${model}`;
	}
	if (agent === "opencode") {
		return model.includes("/") ? model : null;
	}
	return null;
}

/**
 * Where `agent` running `model` is in the catalog for what it takes in:
 * as {@link catalogKey}, and Claude's too, by the roster `name` its short
 * model id has (`Opus 5.5` is `anthropic/claude-opus-5-5`).
 */
export function inputKey(
	agent: string,
	model: string | null,
	name: string | null,
): string | null {
	if (agent === "claude") {
		return name === null
			? null
			: `anthropic/claude-${name
					.trim()
					.toLowerCase()
					.replace(/[\s.]+/g, "-")}`;
	}
	return catalogKey(agent, model);
}

/**
 * What `tokens` cost at `price`, in dollars, at the dearest tier the turn's
 * context reached: the requests that fill a turn read it over and over, so
 * its last size stands for them.
 */
export function priced(price: Price, tokens: TurnTokens): number {
	const rate =
		price.tiers
			.filter(
				(tier) => tokens.context !== null && tokens.context > tier.context,
			)
			.sort((one, other) => other.context - one.context)[0] ?? price;
	return (
		(tokens.input * rate.input +
			tokens.cachedRead * rate.cacheRead +
			tokens.cachedWrite * rate.cacheWrite +
			tokens.output * rate.output) /
		1_000_000
	);
}

function rateOf(value: unknown): Rate | null {
	if (
		!isRecord(value) ||
		typeof value.input !== "number" ||
		typeof value.output !== "number"
	) {
		return null;
	}
	const { input, output } = value;
	return {
		input,
		output,
		// Unsaid, a cached token is billed as any other read.
		cacheRead: typeof value.cache_read === "number" ? value.cache_read : input,
		cacheWrite:
			typeof value.cache_write === "number" ? value.cache_write : input,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
