import type { AwsCredentials } from "../cloud/aws-sign";
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
	 * not counted yet, `counted` counted by splates as it is used.
	 */
	state: "ok" | "missing" | "unreachable" | "untracked" | "counted";
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
	/** The AWS credentials to sign with, null when none are found. */
	aws?(): Promise<AwsCredentials | null>;
	/** The day a provider signed with AWS credentials was last pulled, which is pulled once a day. */
	pulledOn?(provider: string): Promise<string | undefined>;
	/** Keeps that `provider` was pulled on `day`. */
	pulled?(provider: string, day: string): Promise<void>;
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
		aws: null,
		now: new Date(),
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
		let pullSources = sources;
		let token = "";
		if (provider.signed === "aws") {
			if ((await opts.pulledOn?.(provider.id)) === opts.today) {
				statuses.push(status("ok", ""));
				continue;
			}
			const credentials = (await opts.aws?.()) ?? null;
			if (credentials === null) {
				statuses.push(
					status(
						"missing",
						"splates found no AWS credentials: run `aws configure sso` or `aws login` on this machine, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
					),
				);
				continue;
			}
			pullSources = { ...sources, aws: credentials, now: new Date() };
		} else {
			const unpulled = unpulledStatus(provider);
			if (unpulled !== null) {
				statuses.push(unpulled);
				continue;
			}
		}
		if (provider.signed === undefined && provider.cred !== null) {
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
			const charges = (
				(await provider.pull?.(pullSources, token)) ?? []
			).filter(
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
			if (provider.signed !== undefined) {
				await opts.pulled?.(provider.id, opts.today);
			}
			statuses.push(status("ok", "", entries.length));
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
	if (
		provider.signed === undefined &&
		(provider.pull === undefined || provider.cred === null)
	) {
		return status(
			"untracked",
			provider.untracked ?? "splates does not count it yet",
		);
	}
	return null;
}
