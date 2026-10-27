import { cloudflare, openai } from "./adapters";
import type { Expected } from "./plans";

/** One amount a provider billed, in its own currency. */
export interface Charge {
	/** The day it was billed, `2026-10-20`. */
	day: string;
	service: string;
	amount: number;
	currency: string;
	/** Unique within the provider, so the same charge pulled twice is kept once. */
	ref: string;
}

/** What an adapter needs: a way to read a cred, and the network. */
export interface Sources {
	cred(name: string): Promise<string | undefined>;
	fetcher: typeof fetch;
	/** The date now (`2026-10-21`). */
	today: string;
	/** The earliest day to pull. */
	since: string;
}

export interface Provider {
	id: string;
	/** The cred it reads, for the Creds page to ask for. */
	cred: string | null;
	/**
	 * Set for a provider splates does not count yet: what to say on its row.
	 */
	untracked?: string;
	/**
	 * Set for a provider splates counts itself as it uses it, with nothing to
	 * pull: what to say on its row.
	 */
	counted?: string;
	/** Set for a provider with no bill to pull, estimated from list prices: what to say on its row. */
	estimated?: string;
	/** Set when the bill trails use: what to say on the pulled row. */
	lags?: string;
	/** Where the provider's own billing page is, for a row to link to. */
	dashboard?: string;
	pull?(sources: Sources, token: string): Promise<Charge[]>;
	/** What the provider says it will charge next and has not billed yet. */
	upcoming?(sources: Sources, token: string): Promise<Expected[]>;
}

/** Every provider billed outside splates, those not counted yet said so. */
export const PROVIDERS: readonly Provider[] = [
	openai,
	cloudflare,
	{
		id: "typesafe",
		cred: null,
		counted:
			"Only splates's own Jev calls, priced from their tokens since splates began recording them; TypeSafe has no billing API, so use by other apps on the same key shows only in its console",
		dashboard: "https://console.typesafe.ai",
	},
];
