/** A judgment with one question, for a judge's tests. */
export const JUDGMENT = {
	state: { prompt: "hi" },
	questions: { lookup: { type: "noul" as const, instructions: "Is it?" } },
};

/** A fetch that answers `body` with `status`, recording each request. */
export function serve(body: unknown, status = 200) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch = (async (url: string, init: RequestInit) => {
		requests.push({ url, init });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof globalThis.fetch;
	return { fetch, requests };
}
