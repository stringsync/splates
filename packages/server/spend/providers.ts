import { cloudflare, openai } from "./adapters";

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
	/** Only days before this one (`2026-10-21`) are pulled, as a day not over is still changing. */
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
	 * Costs are never entered by hand, so such a provider waits on a pull or
	 * on splates counting its own use.
	 */
	untracked?: string;
	/**
	 * Set for a provider splates counts itself as it uses it, with nothing to
	 * pull: what to say on its row.
	 */
	counted?: string;
	/**
	 * Set for a provider with no bill to pull, whose cost splates estimates
	 * itself from list prices: what to say on its row.
	 */
	estimated?: string;
	/** Where the provider's own billing page is, for a row to link to. */
	dashboard?: string;
	pull?(sources: Sources, token: string): Promise<Charge[]>;
}

/** Every provider billed outside splates, those not counted yet said so. */
export const PROVIDERS: readonly Provider[] = [
	openai,
	cloudflare,
	{
		id: "typesafe",
		cred: null,
		counted:
			"Priced from the tokens each of splates's own Jev calls uses; other apps on the same key are not counted",
	},
];
