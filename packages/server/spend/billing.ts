import type { Expected } from "./plans";
import {
	type Charge,
	PROVIDERS,
	type Provider,
	type Sources,
} from "./providers";
import { Rates } from "./rates";
import type { Spend } from "./spend";
import type { SpendEntry } from "./totals";

/** How a provider's row on the Billing page reads after a pull. */
export interface ProviderStatus {
	provider: string;
	/**
	 * `ok` pulled, `missing` has no cred, `unreachable` failed, `untracked`
	 * not counted yet, `counted` counted by splates as it is used,
	 * `estimated` estimated by splates from list prices, with no bill to pull.
	 */
	state:
		| "ok"
		| "missing"
		| "unreachable"
		| "untracked"
		| "counted"
		| "estimated";
	/** What to tell the user; for `ok`, only a note that the bill trails use. */
	message: string;
	/** How many new charges the pull added. */
	added: number;
	/** What the provider says it will charge next, not billed yet. */
	expected?: Expected[];
}

export interface BillingOptions {
	cred(name: string): Promise<string | undefined>;
	/** The display currency; USD unsaid. */
	currency?: string;
	fetcher?: typeof fetch;
	/** The date now, `2026-10-21`. */
	today: string;
	/** How far back to pull; 90 days unsaid. */
	days?: number;
	providers?: readonly Provider[];
}

/**
 * Pulls what each provider billed into the ledger, converted to the display
 * currency, once per charge however often it runs. A provider that cannot be
 * reached is reported, never recorded as zero.
 */
export async function pullBilling(
	spend: Spend,
	opts: BillingOptions,
): Promise<ProviderStatus[]> {
	const fetcher = opts.fetcher ?? fetch;
	const rates = new Rates(opts.currency, fetcher);
	const since = new Date(
		Date.parse(`${opts.today}T00:00:00Z`) - (opts.days ?? 90) * 86_400_000,
	)
		.toISOString()
		.slice(0, 10);
	const sources: Sources = {
		cred: opts.cred,
		fetcher,
		today: opts.today,
		since,
	};
	const kept = new Set(
		(await spend.entries()).flatMap((each) => (each.ref ? [each.ref] : [])),
	);
	const statuses: ProviderStatus[] = [];
	for (const provider of opts.providers ?? PROVIDERS) {
		const status = (
			state: ProviderStatus["state"],
			message: string,
			added = 0,
		): ProviderStatus => ({ provider: provider.id, state, message, added });
		const unpulled = unpulledStatus(provider);
		if (unpulled !== null) {
			statuses.push(unpulled);
			continue;
		}
		let token = "";
		if (provider.cred !== null) {
			const found = await opts.cred(provider.cred);
			if (found === undefined) {
				statuses.push(
					status("missing", `needs ${provider.cred}: add it on the Creds page`),
				);
				continue;
			}
			token = found;
		}
		try {
			const charges = ((await provider.pull?.(sources, token)) ?? []).filter(
				(charge: Charge) =>
					charge.day >= since &&
					charge.day < sources.today &&
					!kept.has(charge.ref),
			);
			const entries: SpendEntry[] = [];
			for (const charge of charges) {
				const { dollars, original } = await rates.convert(
					charge.amount,
					charge.currency,
					charge.day,
				);
				entries.push({
					at: `${charge.day}T00:00:00.000Z`,
					provider: provider.id,
					service: charge.service,
					kind: "billed",
					dollars,
					project: null,
					task: null,
					conversation: null,
					ref: charge.ref,
					original,
				});
				kept.add(charge.ref);
			}
			await spend.record(...entries);
			const expected = (await provider.upcoming?.(sources, token)) ?? [];
			statuses.push({
				...status("ok", provider.lags ?? "", entries.length),
				expected,
			});
		} catch (error) {
			statuses.push(
				status(
					"unreachable",
					error instanceof Error ? error.message : String(error),
				),
			);
		}
	}
	return statuses;
}

/** How the row of a provider splates never pulls reads; null for one it does. */
export function unpulledStatus(provider: Provider): ProviderStatus | null {
	const status = (state: ProviderStatus["state"], message: string) => ({
		provider: provider.id,
		state,
		message,
		added: 0,
	});
	if (provider.counted !== undefined) {
		return status("counted", provider.counted);
	}
	if (provider.estimated !== undefined) {
		return status("estimated", provider.estimated);
	}
	if (provider.pull === undefined || provider.cred === null) {
		return status(
			"untracked",
			provider.untracked ?? "splates does not count it yet",
		);
	}
	return null;
}
