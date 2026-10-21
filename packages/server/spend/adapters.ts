import { AwsSigner } from "../cloud/aws-sign";
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
};

/** Cost Explorer's daily unblended cost by service; it bills $0.01 a request and runs about a day behind. */
export const aws: Provider = {
	id: "aws",
	cred: null,
	signed: "aws",
	async pull(sources) {
		if (sources.aws === null) {
			throw new Error("no AWS credentials");
		}
		const url = new URL("https://ce.us-east-1.amazonaws.com/");
		const signer = new AwsSigner(sources.aws, "us-east-1", "ce");
		const charges: Charge[] = [];
		let page: string | undefined;
		do {
			const request = JSON.stringify({
				TimePeriod: { Start: sources.since, End: sources.today },
				Granularity: "DAILY",
				Metrics: ["UnblendedCost"],
				GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
				...(page === undefined ? {} : { NextPageToken: page }),
			});
			const response = await sources.fetcher(url, {
				method: "POST",
				headers: signer.sign(
					{
						method: "POST",
						url,
						headers: {
							"content-type": "application/x-amz-json-1.1",
							"x-amz-target": "AWSInsightsIndexService.GetCostAndUsage",
						},
						body: request,
					},
					sources.now,
				),
				body: request,
			});
			if (!response.ok) {
				throw new Error(
					response.status === 400 || response.status === 403
						? `AWS refused the credentials (${response.status}): they need ce:GetCostAndUsage, and Cost Explorer turned on for the account`
						: `${url.host} answered ${response.status}`,
				);
			}
			const body = (await response.json()) as {
				NextPageToken?: string | null;
				ResultsByTime?: {
					TimePeriod: { Start: string };
					Groups?: {
						Keys: string[];
						Metrics: { UnblendedCost: { Amount: string; Unit: string } };
					}[];
				}[];
			};
			for (const result of body.ResultsByTime ?? []) {
				const billed = result.TimePeriod.Start;
				for (const group of result.Groups ?? []) {
					const service = group.Keys[0] ?? "other";
					charges.push({
						day: billed,
						service,
						amount: Number(group.Metrics.UnblendedCost.Amount),
						currency: group.Metrics.UnblendedCost.Unit,
						ref: `aws:${billed}:${service}`,
					});
				}
			}
			page = body.NextPageToken ?? undefined;
		} while (page !== undefined);
		return charges;
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
