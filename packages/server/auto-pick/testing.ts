import type { Judge, Judgment, Verdict } from "./system-one";

/** A fetch that answers `body` with `status`, recording each request. */
export function serve(body: unknown, status = 200) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch = (async (url: string, init: RequestInit) => {
		requests.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, requests };
}

/** A judge that answers every judgment with `answers`, recording each it was asked. */
export class FakeJudge implements Judge {
	readonly asked: Judgment[] = [];

	constructor(
		private readonly answers: Record<string, number> = {},
		/** What it says each judgment cost; it says no price when not given. */
		private readonly dollars?: number,
	) {}

	async judge(judgment: Judgment): Promise<Verdict> {
		this.asked.push(judgment);
		return {
			answers: new Map(Object.entries(this.answers)),
			...(this.dollars === undefined ? {} : { dollars: this.dollars }),
		};
	}
}
