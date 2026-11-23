import { z } from "zod";
import { fail } from "../exit";
import type { LimitPeak } from "../models";
import { body } from "../server/shared";
import type { Storage } from "../storage";
import { type ProviderStatus, pullBilling, unpulledStatus } from "./billing";
import {
	mergePlans,
	PLAN_PROVIDERS,
	type Plan,
	type PlanOverride,
	type PlanProvider,
	type PlanView,
	planViews,
	renewals,
} from "./plans";
import { PROVIDERS } from "./providers";
import { Rates } from "./rates";
import { type SpendReport, spendReport } from "./report";
import type { Spend } from "./spend";
import { type UnusedQuotaReport, unusedQuotaReport } from "./unused-quota";

/** The currencies the Billing page offers, the European Central Bank's most traded. */
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"];

const PLAN_OVERRIDE = z.object({
	amount: z.number().positive().finite(),
	renewalDay: z.number().int().min(1).max(31),
	currency: z.string(),
});

const SETTINGS = z.object({
	currency: z.string().optional(),
	plans: z.record(z.string(), PLAN_OVERRIDE).optional(),
});

/** What the Billing page shows of its sources. */
export interface BillingView {
	currency: string;
	currencies: string[];
	/** When providers were last pulled, or null before the first pull. */
	pulledAt: string | null;
	/** Each provider, with the cred it reads and how its last pull went. */
	providers: (ProviderStatus & {
		cred: string | null;
		/** Where the provider's own billing page is; null for none. */
		dashboard: string | null;
	})[];
	/** Each agent provider's active subscription plan, detected or saved manually. */
	plans?: PlanView[];
}

/** What a `BillingRoutes` reads beyond the ledger. */
export interface BillingRoutesOptions {
	fetcher?: typeof fetch;
	/** The agent plans this machine is signed in to, whose renewals the bill expects; none unsaid. */
	plans?: () => Promise<Plan[]>;
	/** Recorded per-reset usage peaks, by agent id; none unsaid. */
	limits?: () => Promise<Record<string, LimitPeak[]>>;
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
	private readonly plans: () => Promise<Plan[]>;
	private readonly limits: () => Promise<Record<string, LimitPeak[]>>;

	// vet-ignore objects-over-callbacks: a lookup of one credential by name, run per pull to compute its result
	constructor(
		storage: Storage,
		private readonly ledger: Spend,
		private readonly cred: (name: string) => Promise<string | undefined>,
		opts: BillingRoutesOptions = {},
	) {
		this.fetcher = opts.fetcher ?? fetch;
		this.plans = opts.plans ?? (async () => []);
		this.limits = opts.limits ?? (async () => ({}));
		this.#settings = storage.document("billing.json", { schema: SETTINGS });
	}

	private async settings(): Promise<{
		currency: string;
		plans: Partial<Record<PlanProvider, PlanOverride>>;
	}> {
		const saved = await this.#settings.read();
		const overrides: Partial<Record<PlanProvider, PlanOverride>> = {};
		for (const provider of PLAN_PROVIDERS) {
			const entry = saved?.plans?.[provider];
			if (entry !== undefined) {
				overrides[provider] = entry;
			}
		}
		return {
			currency: saved?.currency ?? "USD",
			plans: overrides,
		};
	}

	async currency(): Promise<string> {
		return (await this.settings()).currency;
	}

	private async view(): Promise<BillingView> {
		const statuses = this.#pulled?.statuses ?? [];
		const [saved, detected] = await Promise.all([
			this.settings(),
			this.plans(),
		]);
		return {
			currency: saved.currency,
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
				dashboard: provider.dashboard ?? null,
			})),
			plans: planViews(detected, saved.plans),
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
		const saved = await this.settings();
		await this.#settings.write({ currency, plans: saved.plans });
		return Response.json(await this.view());
	};

	readonly setPlan = async (request: Request): Promise<Response> => {
		const payload = await body(request);
		const provider = payload.provider;
		if (
			typeof provider !== "string" ||
			!PLAN_PROVIDERS.includes(provider as PlanProvider)
		) {
			fail("usage", `provider is one of ${PLAN_PROVIDERS.join(", ")}`, {
				provider,
			});
		}
		const amount = payload.amount;
		if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
			fail("usage", "amount must be a positive number", { amount });
		}
		const renewalDay = payload.renewalDay;
		if (
			typeof renewalDay !== "number" ||
			!Number.isInteger(renewalDay) ||
			renewalDay < 1 ||
			renewalDay > 31
		) {
			fail("usage", "renewalDay must be an integer from 1 to 31", {
				renewalDay,
			});
		}
		const saved = await this.settings();
		const currency =
			payload.currency === undefined ? saved.currency : payload.currency;
		if (typeof currency !== "string" || !CURRENCIES.includes(currency)) {
			fail("usage", `currency is one of ${CURRENCIES.join(", ")}`, {
				currency,
			});
		}
		await this.#settings.write({
			currency: saved.currency,
			plans: {
				...saved.plans,
				[provider]: { amount, renewalDay, currency },
			},
		});
		return Response.json(await this.view());
	};

	readonly clearPlan = async (request: Request): Promise<Response> => {
		const queryProvider = new URL(request.url).searchParams.get("provider");
		const parsed: Record<string, unknown> =
			queryProvider !== null ? {} : await body(request).catch(() => ({}));
		const provider = queryProvider ?? parsed.provider;
		if (
			typeof provider !== "string" ||
			!PLAN_PROVIDERS.includes(provider as PlanProvider)
		) {
			fail("usage", `provider is one of ${PLAN_PROVIDERS.join(", ")}`, {
				provider,
			});
		}
		const saved = await this.settings();
		const next = { ...saved.plans };
		delete next[provider as PlanProvider];
		await this.#settings.write({ currency: saved.currency, plans: next });
		return Response.json(await this.view());
	};

	/** The spend in the display currency. */
	readonly spend = async (request: Request): Promise<Response> => {
		const { searchParams } = new URL(request.url);
		const now = new Date().toISOString();
		const since = searchParams.get("since") ?? undefined;
		const until = searchParams.get("until") ?? undefined;
		// Renewals from the range's start to a month past its end, which covers what is upcoming.
		const from = since ?? (await this.ledger.entries())[0]?.at ?? now;
		const to = new Date(
			Date.parse(until ?? now) + 32 * 86_400_000,
		).toISOString();
		const [saved, detected] = await Promise.all([
			this.settings(),
			this.plans(),
		]);
		const report: SpendReport = await spendReport(this.ledger, {
			since,
			until,
			now,
			rates: new Rates(saved.currency, this.fetcher),
			expected: [
				...renewals(mergePlans(detected, saved.plans), from, to),
				...(this.#pulled?.statuses ?? []).flatMap(
					(status) => status.expected ?? [],
				),
			],
		});
		return Response.json(report);
	};

	/** Ranked unused subscription quota over the last `days` (28 or 90, default 28). */
	readonly unusedQuota = async (request: Request): Promise<Response> => {
		const rawDays = Number(
			new URL(request.url).searchParams.get("days") ?? "28",
		);
		const days = rawDays === 90 ? 90 : 28;
		const now = new Date().toISOString();
		const [saved, detected, peaks] = await Promise.all([
			this.settings(),
			this.plans(),
			this.limits(),
		]);
		const report: UnusedQuotaReport = await unusedQuotaReport({
			days,
			now,
			plans: mergePlans(detected, saved.plans),
			peaks,
			ledger: this.ledger,
			rates: new Rates(saved.currency, this.fetcher),
		});
		return Response.json(report);
	};
}
