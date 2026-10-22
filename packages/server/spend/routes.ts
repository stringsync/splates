import { z } from "zod";
import { fail } from "../exit";
import { body } from "../server/shared";
import type { Storage } from "../storage";
import { type ProviderStatus, pullBilling, unpulledStatus } from "./billing";
import { PROVIDERS } from "./providers";
import { Rates } from "./rates";
import { type SpendReport, spendReport } from "./report";
import { type RunnerJobRow, runnersReport } from "./runners";
import type { Spend } from "./spend";

/** The currencies the Billing page offers, the European Central Bank's most traded. */
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"];

const SETTINGS = z.object({ currency: z.string() });

/** What the Billing page shows of its sources. */
export interface BillingView {
	currency: string;
	currencies: string[];
	/** When providers were last pulled, or null before the first pull. */
	pulledAt: string | null;
	/** Each provider, with the cred it reads and how its last pull went. */
	providers: (ProviderStatus & { cred: string | null })[];
}

/** What runs on runners now, which the ledger keeps a job of once it ends. */
export interface RunningJobs {
	runningJobs(): RunnerJobRow[];
}

/** What a `BillingRoutes` reads beyond the ledger; the real fetch and no runners by default. */
export interface BillingRoutesOptions {
	fetcher?: typeof fetch;
	jobs?: RunningJobs;
}

/**
 * The Billing page's sources: the display currency, kept on the machine, and
 * a pull of what each provider billed, whose results the page reads back.
 */
export class BillingRoutes {
	readonly #settings;
	#pulled: { at: string; statuses: ProviderStatus[] } | null = null;
	#pulling: Promise<void> | null = null;
	private readonly fetcher: typeof fetch;
	private readonly jobs: RunningJobs | null;

	constructor(
		storage: Storage,
		private readonly ledger: Spend,
		private readonly cred: (name: string) => Promise<string | undefined>,
		opts: BillingRoutesOptions = {},
	) {
		this.fetcher = opts.fetcher ?? fetch;
		this.jobs = opts.jobs ?? null;
		this.#settings = storage.document("billing.json", { schema: SETTINGS });
	}

	async currency(): Promise<string> {
		return (await this.#settings.read())?.currency ?? "USD";
	}

	private async view(): Promise<BillingView> {
		const statuses = this.#pulled?.statuses ?? [];
		return {
			currency: await this.currency(),
			currencies: CURRENCIES,
			pulledAt: this.#pulled?.at ?? null,
			providers: PROVIDERS.map((provider) => ({
				...(statuses.find((each) => each.provider === provider.id) ??
					unpulledStatus(provider) ?? {
						provider: provider.id,
						state: "ok" as const,
						message: "",
						added: 0,
					}),
				cred: provider.cred,
			})),
		};
	}

	/** The sources as last pulled. */
	readonly read = async (): Promise<Response> =>
		Response.json(await this.view());

	/** Pulls every provider's billing, once at a time, and answers as `read` does. */
	readonly pull = async (): Promise<Response> => {
		this.#pulling ??= (async () => {
			const now = new Date().toISOString();
			const statuses = await pullBilling(this.ledger, {
				cred: this.cred,
				fetcher: this.fetcher,
				today: now.slice(0, 10),
			});
			this.#pulled = { at: now, statuses };
		})().finally(() => {
			this.#pulling = null;
		});
		await this.#pulling;
		return Response.json(await this.view());
	};

	readonly setCurrency = async (request: Request): Promise<Response> => {
		const { currency } = await body(request);
		if (typeof currency !== "string" || !CURRENCIES.includes(currency)) {
			fail("usage", `currency is one of ${CURRENCIES.join(", ")}`, {
				currency,
			});
		}
		await this.#settings.write({ currency });
		return Response.json(await this.view());
	};

	/** The spend in the display currency. */
	readonly spend = async (request: Request): Promise<Response> => {
		const { searchParams } = new URL(request.url);
		const report: SpendReport = await spendReport(this.ledger, {
			since: searchParams.get("since") ?? undefined,
			until: searchParams.get("until") ?? undefined,
			now: new Date().toISOString(),
			rates: new Rates(await this.currency(), this.fetcher),
		});
		return Response.json(report);
	};

	/** Every runner ever made, what each cost, and their days and months beside the bill. */
	readonly runners = async (): Promise<Response> =>
		Response.json(
			runnersReport(
				await this.ledger.lines(),
				Date.now(),
				this.jobs?.runningJobs() ?? [],
			),
		);
}
