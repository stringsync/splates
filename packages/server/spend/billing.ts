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
	/** `ok` pulled, `missing` has no cred, `unreachable` failed, `manual` has no cost API. */
	state: "ok" | "missing" | "unreachable" | "manual";
	/** What to tell the user; empty for `ok`. */
	message: string;
	/** How many new charges the pull added. */
	added: number;
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
	options: BillingOptions,
): Promise<ProviderStatus[]> {
	const fetcher = options.fetcher ?? fetch;
	const rates = new Rates(options.currency, fetcher);
	const since = new Date(
		Date.parse(`${options.today}T00:00:00Z`) -
			(options.days ?? 90) * 86_400_000,
	)
		.toISOString()
		.slice(0, 10);
	const sources: Sources = {
		cred: options.cred,
		fetcher,
		today: options.today,
		since,
	};
	const kept = new Set(
		(await spend.entries()).flatMap((each) => (each.ref ? [each.ref] : [])),
	);
	const statuses: ProviderStatus[] = [];
	for (const provider of options.providers ?? PROVIDERS) {
		const status = (
			state: ProviderStatus["state"],
			message: string,
			added = 0,
		): ProviderStatus => ({ provider: provider.id, state, message, added });
		if (provider.pull === undefined || provider.cred === null) {
			statuses.push(status("manual", provider.manual ?? "no cost API"));
			continue;
		}
		const token = await options.cred(provider.cred);
		if (token === undefined) {
			statuses.push(
				status("missing", `needs ${provider.cred}: add it on the Creds page`),
			);
			continue;
		}
		try {
			const charges = (await provider.pull(sources, token)).filter(
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
			statuses.push(status("ok", "", entries.length));
		} catch (error) {
			statuses.push(
				status(
					"unreachable",
					`could not reach ${provider.id}: ${String(error)}`,
				),
			);
		}
	}
	return statuses;
}
