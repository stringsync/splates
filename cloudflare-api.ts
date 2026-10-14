import { z } from "zod";
import { CloudflareError } from "./cloudflare-error";

/** Where Cloudflare's v4 API answers. */
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** Every v4 answer is wrapped in this envelope, its result left to the caller. */
const Envelope = z.object({
	success: z.boolean(),
	errors: z
		.array(z.object({ code: z.number().optional(), message: z.string() }))
		.default([]),
	result: z.unknown(),
	result_info: z.object({ total_pages: z.number().optional() }).optional(),
});

/** How many items a list asks for at once, the most every list allows. */
const PER_PAGE = 50;

/**
 * The few calls `arbor tunnel setup` makes of Cloudflare's v4 API, over plain
 * `fetch` rather than the `cloudflare` SDK, which every `bunx` of arbor would
 * download for some ten endpoints. Each answer's result is checked against
 * the shape the caller names, so a field that moved fails here, saying where.
 */
export class CloudflareApi {
	private readonly fetch: typeof fetch;

	constructor(
		private readonly token: string,
		opts: { fetch?: typeof fetch } = {},
	) {
		this.fetch = opts.fetch ?? fetch;
	}

	async get<T>(path: string, shape: z.ZodType<T>): Promise<T> {
		return (await this.call("GET", path, shape)).result;
	}

	/** Every item of the list at `path`, page after page. */
	async list<T>(path: string, item: z.ZodType<T>): Promise<T[]> {
		const items: T[] = [];
		const join = path.includes("?") ? "&" : "?";
		for (let page = 1; ; page++) {
			const { result, pages } = await this.call(
				"GET",
				`${path}${join}page=${page}&per_page=${PER_PAGE}`,
				z.array(item),
			);
			items.push(...result);
			if (page >= pages || result.length === 0) {
				return items;
			}
		}
	}

	async post<T>(path: string, body: unknown, shape: z.ZodType<T>): Promise<T> {
		return (await this.call("POST", path, shape, body)).result;
	}

	async put<T>(path: string, body: unknown, shape: z.ZodType<T>): Promise<T> {
		return (await this.call("PUT", path, shape, body)).result;
	}

	async patch<T>(path: string, body: unknown, shape: z.ZodType<T>): Promise<T> {
		return (await this.call("PATCH", path, shape, body)).result;
	}

	/** Deletes what is at `path`, whatever Cloudflare answers with. */
	async delete(path: string): Promise<void> {
		await this.call("DELETE", path, z.unknown());
	}

	private async call<T>(
		method: string,
		path: string,
		shape: z.ZodType<T>,
		body?: unknown,
	): Promise<{ result: T; pages: number }> {
		const response = await this.fetch(`${CLOUDFLARE_API}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		let envelope: z.infer<typeof Envelope>;
		try {
			envelope = Envelope.parse(JSON.parse(text));
		} catch {
			throw new CloudflareError(
				response.status,
				`${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`,
			);
		}
		if (!response.ok || !envelope.success) {
			const why = envelope.errors
				.map(
					(error) => `${error.message}${error.code ? ` (${error.code})` : ""}`,
				)
				.join("; ");
			throw new CloudflareError(
				response.status,
				`${method} ${path} answered ${response.status}: ${why || "no reason given"}`,
			);
		}
		const result = shape.safeParse(envelope.result);
		if (!result.success) {
			throw new Error(
				`${method} ${path} answered in an unexpected shape: ${result.error.message}`,
			);
		}
		return {
			result: result.data,
			pages: envelope.result_info?.total_pages ?? 1,
		};
	}
}
