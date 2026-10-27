import type { Expected } from "./plans";
import type { Charge, Provider, Sources } from "./providers";

/** Organization costs by day and line item; needs an admin key. */
export const openai: Provider = {
	id: "openai",
	cred: "OPENAI_ADMIN_KEY",
	async pull(sources, token) {
		const start = Math.floor(Date.parse(`${sources.since}T00:00:00Z`) / 1000);
		const charges: Charge[] = [];
		let page: string | null = null;
		do {
			const url: string = `https://api.openai.com/v1/organization/costs?start_time=${start}&bucket_width=1d&group_by=line_item&limit=180${page === null ? "" : `&page=${page}`}`;
			const body = (await getJson(sources, url, token)) as {
				data?: {
					start_time: number;
					results: {
						amount: { value: number; currency: string };
						line_item?: string | null;
					}[];
				}[];
				has_more?: boolean;
				next_page?: string | null;
			};
			for (const bucket of body.data ?? []) {
				const billed = day(bucket.start_time);
				for (const result of bucket.results) {
					const service = result.line_item ?? "other";
					charges.push({
						day: billed,
						service,
						amount: result.amount.value,
						currency: result.amount.currency,
						ref: `openai:${billed}:${service}`,
					});
				}
			}
			page = body.has_more === true ? (body.next_page ?? null) : null;
		} while (page !== null);
		return charges;
	},
};

/** The account's billing history: each charge as Cloudflare invoiced it. */
export const cloudflare: Provider = {
	id: "cloudflare",
	cred: "CLOUDFLARE_API_TOKEN",
	async pull(sources, token) {
		const body = (await getJson(
			sources,
			"https://api.cloudflare.com/client/v4/user/billing/history?per_page=100",
			token,
		)) as {
			result?: {
				id: string;
				amount: number;
				currency: string;
				occurred_at: string;
				description?: string;
				type?: string;
			}[];
		};
		return (body.result ?? []).map((item) => ({
			day: day(item.occurred_at),
			service: item.description ?? item.type ?? "other",
			amount: item.amount,
			currency: item.currency,
			ref: `cloudflare:${item.id}`,
		}));
	},
	/** Each paid subscription's charge at the end of its current period, invoiced then. */
	async upcoming(sources, token) {
		const accounts = (await getJson(
			sources,
			"https://api.cloudflare.com/client/v4/accounts",
			token,
		)) as { result?: { id: string }[] };
		const due: Expected[] = [];
		for (const account of accounts.result ?? []) {
			const body = (await getJson(
				sources,
				`https://api.cloudflare.com/client/v4/accounts/${account.id}/subscriptions`,
				token,
			)) as {
				result?: {
					price: number;
					currency: string;
					current_period_end?: string;
					rate_plan?: { public_name?: string };
				}[];
			};
			for (const each of body.result ?? []) {
				if (each.price > 0 && each.current_period_end !== undefined) {
					due.push({
						provider: "cloudflare",
						service: each.rate_plan?.public_name ?? "subscription",
						day: day(each.current_period_end),
						amount: each.price,
						currency: each.currency,
					});
				}
			}
		}
		return due.filter((each) => each.day >= sources.today);
	},
};

async function getJson(
	sources: Sources,
	url: string,
	token: string,
): Promise<unknown> {
	const response = await sources.fetcher(url, {
		headers: { authorization: `Bearer ${token}` },
	});
	if (!response.ok) {
		const host = new URL(url).host;
		throw new Error(
			response.status === 401 || response.status === 403
				? `${host} refused the token (${response.status}): check it is current and can read billing`
				: `${host} answered ${response.status}`,
		);
	}
	return response.json();
}

function day(at: string | number): string {
	return new Date(typeof at === "number" ? at * 1000 : at)
		.toISOString()
		.slice(0, 10);
}
