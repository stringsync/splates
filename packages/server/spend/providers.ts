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
	/** Set for a provider with no cost API: what to say on its row. */
	manual?: string;
	pull?(sources: Sources, token: string): Promise<Charge[]>;
}

async function getJson(
	sources: Sources,
	url: string,
	token: string,
): Promise<unknown> {
	const response = await sources.fetcher(url, {
		headers: { authorization: `Bearer ${token}` },
	});
	if (!response.ok) {
		throw new Error(`${new URL(url).host} answered ${response.status}`);
	}
	return response.json();
}

const day = (at: string | number): string =>
	new Date(typeof at === "number" ? at * 1000 : at).toISOString().slice(0, 10);

/** Organization costs by day and line item; needs an admin key. */
const openai: Provider = {
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
const cloudflare: Provider = {
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
};

/** Invoices, one per month, in dollars. */
const digitalocean: Provider = {
	id: "digitalocean",
	cred: "DIGITALOCEAN_TOKEN",
	async pull(sources, token) {
		const body = (await getJson(
			sources,
			"https://api.digitalocean.com/v2/customers/my/invoices?per_page=100",
			token,
		)) as {
			invoices?: {
				invoice_uuid: string;
				amount: string;
				invoice_period: string;
			}[];
		};
		return (body.invoices ?? []).map((invoice) => ({
			day: `${invoice.invoice_period}-01`,
			service: "droplets",
			amount: Number(invoice.amount),
			currency: "USD",
			ref: `digitalocean:${invoice.invoice_uuid}`,
		}));
	},
};

/** Every provider billed outside splates, those with no cost API said so. */
export const PROVIDERS: readonly Provider[] = [
	openai,
	cloudflare,
	digitalocean,
	{
		id: "hetzner",
		cred: null,
		manual:
			"Hetzner Cloud has no billing API: enter its monthly invoice by hand",
	},
	{
		id: "aws",
		cred: null,
		manual:
			"AWS Cost Explorer needs request signing and charges per call: enter its monthly bill by hand",
	},
	{
		id: "typesafe",
		cred: null,
		manual: "TypeSafe AI publishes no cost API: enter its usage by hand",
	},
];
