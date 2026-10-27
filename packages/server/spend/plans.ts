import type { Fs } from "webappwiz/system";
import { kimiSubscription } from "../models";

/**
 * A charge on the bill that no provider has billed yet as splates sees it:
 * an agent plan's renewal, priced at its list price since no plan has a
 * billing API, or a subscription a provider says it will invoice.
 */
export interface Expected {
	provider: string;
	service: string;
	/** The day it is charged, `2026-10-30`. */
	day: string;
	amount: number;
	currency: string;
}

/** A plan and how much it charges each renewal. */
export interface Plan {
	provider: string;
	/** The plan's name, as the Billing page shows it: `Max 20x plan`. */
	service: string;
	amount: number;
	currency: string;
	/** How many months pass between renewals. */
	everyMonths: number;
	/** When it began, or the earliest renewal its source confirms, as an ISO timestamp. */
	since: string;
}

/**
 * Claude's plans by the rate limit tier its login keeps, at their list
 * prices (https://claude.com/pricing).
 */
const CLAUDE_TIERS: Record<string, { service: string; amount: number }> = {
	default_claude_max_20x: { service: "Max 20x plan", amount: 200 },
	default_claude_max_5x: { service: "Max 5x plan", amount: 100 },
	default_claude_ai: { service: "Pro plan", amount: 20 },
};

/**
 * ChatGPT's plans by the plan type Codex's login keeps, at their list
 * prices (https://chatgpt.com/pricing).
 */
const CHATGPT_PLANS: Record<string, { service: string; amount: number }> = {
	pro: { service: "Pro plan", amount: 200 },
	prolite: { service: "Pro Lite plan", amount: 100 },
	plus: { service: "Plus plan", amount: 20 },
	go: { service: "Go plan", amount: 8 },
};

/**
 * The agent plans this machine is signed in to, read from their own logins;
 * one that cannot be read or fully priced is left out.
 */
export async function readPlans(
	fs: Fs,
	home: string,
	opts: PlansOptions = {},
): Promise<Plan[]> {
	const plans: Plan[] = [];
	const monthly = { currency: "USD", everyMonths: 1 };
	const claude = await readJson(fs, `${home}/.claude.json`);
	const account = claude?.oauthAccount;
	const tier = CLAUDE_TIERS[account?.organizationRateLimitTier];
	if (
		tier !== undefined &&
		typeof account?.subscriptionCreatedAt === "string"
	) {
		plans.push({
			provider: "claude",
			...tier,
			...monthly,
			since: account.subscriptionCreatedAt,
		});
	}
	const codex = await readJson(fs, `${home}/.codex/auth.json`);
	const claims = jwtClaims(codex?.tokens?.id_token)?.[
		"https://api.openai.com/auth"
	];
	const plan = CHATGPT_PLANS[claims?.chatgpt_plan_type];
	if (
		plan !== undefined &&
		typeof claims?.chatgpt_subscription_active_start === "string"
	) {
		plans.push({
			provider: "codex",
			...plan,
			...monthly,
			since: claims.chatgpt_subscription_active_start,
		});
	}
	if (opts.kimi !== undefined) {
		const { now, ...kimi } = opts.kimi;
		const subscription = await kimiSubscription({
			fs,
			...kimi,
			now: now ?? (() => Date.now()),
		});
		if (subscription !== null) {
			plans.push({ provider: "kimi", ...subscription });
		}
	}
	return plans;
}

export interface PlansOptions {
	/** Where Kimi Code keeps its login and how to ask for its subscription. */
	kimi?: {
		home: string;
		baseUrl?: string;
		fetcher?: typeof fetch;
		now?: () => number;
	};
}

/**
 * Each renewal of `plans` from `since` to `until` (`2026-10-01`, exclusive),
 * at each plan's own interval, on its anchor day or that month's last day.
 */
export function renewals(
	plans: readonly Plan[],
	since: string,
	until: string,
): Expected[] {
	const due: Expected[] = [];
	for (const plan of plans) {
		const began = plan.since.slice(0, 10);
		const anchor = Number(began.slice(8, 10));
		const anchorMonth =
			Number(began.slice(0, 4)) * 12 + Number(began.slice(5, 7)) - 1;
		const from = new Date(`${since.slice(0, 7)}-01T00:00:00Z`);
		for (
			let month = from;
			month.toISOString().slice(0, 10) < until;
			month = new Date(
				Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
			)
		) {
			const elapsed =
				month.getUTCFullYear() * 12 + month.getUTCMonth() - anchorMonth;
			if (elapsed < 0 || elapsed % plan.everyMonths !== 0) {
				continue;
			}
			const last = new Date(
				Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
			).getUTCDate();
			const day = new Date(
				Date.UTC(
					month.getUTCFullYear(),
					month.getUTCMonth(),
					Math.min(anchor, last),
				),
			)
				.toISOString()
				.slice(0, 10);
			if (day >= began && day >= since.slice(0, 10) && day < until) {
				due.push({
					provider: plan.provider,
					service: plan.service,
					day,
					amount: plan.amount,
					currency: plan.currency,
				});
			}
		}
	}
	return due;
}

// biome-ignore lint/suspicious/noExplicitAny: the logins are other programs' files, read field by field
async function readJson(fs: Fs, path: string): Promise<any> {
	try {
		return JSON.parse(await fs.read(path));
	} catch {
		return null;
	}
}

// biome-ignore lint/suspicious/noExplicitAny: claims are read field by field
function jwtClaims(token: unknown): any {
	if (typeof token !== "string") {
		return null;
	}
	try {
		return JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
		);
	} catch {
		return null;
	}
}
