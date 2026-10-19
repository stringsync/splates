import { z } from "zod";

/**
 * A decision model: it reads some state and answers yes-or-no questions about
 * it with the probability of yes. The same shape as scry's `Judge`, so scry's
 * Jev and Clef fit here too, without splates carrying scry's native
 * dependencies; a fake in a test is another.
 */
export interface Judge {
	judge(judgment: Judgment, opts?: JudgeOptions): Promise<Verdict>;
}

/** How one judgment runs. */
export interface JudgeOptions {
	/** Gives up on the judgment when it aborts. */
	signal?: AbortSignal;
}

/** The state once, and every question about it, answered together. */
export interface Judgment {
	/** What the questions are about. A question names its parts by backticked path. */
	state: Record<string, unknown>;
	/** By id, which is for code and never sent as meaning. */
	questions: Record<string, Noul>;
}

/** A yes-or-no question, answered with the probability of yes. */
export interface Noul {
	type: "noul";
	instructions: string;
	/** What a yes and a no each mean, when the line between them is subtle. */
	criteria?: { true: string; false: string };
}

/** What a judge answered: the probability of yes, by question id. */
export interface Verdict {
	answers: Map<string, number>;
}

const REPLY = z.object({
	answers: z.record(
		z.string(),
		z.union([
			z.number(),
			z.object({ noul: z.number() }).transform((answer) => answer.noul),
		]),
	),
});

/**
 * One request to a URL that speaks the System One API, tried once: a caller
 * that cannot wait falls back rather than retrying. Its errors name the judge,
 * never the URL, which can hold an account id.
 */
export async function askSystemOne(
	name: string,
	url: string,
	token: string,
	body: object,
	opts: AskOptions,
): Promise<Verdict> {
	const response = await (opts.fetch ?? fetch)(url, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
		signal: opts.signal,
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`${name} answered ${response.status}`);
	}
	const json: unknown = await response.json().catch(() => undefined);
	// Workers AI wraps the reply in `result`; TypeSafe does not.
	const inner =
		typeof json === "object" && json !== null && "result" in json
			? (json as { result: unknown }).result
			: json;
	const reply = REPLY.safeParse(inner);
	if (!reply.success) {
		throw new Error(`${name} answered with no answers in it`);
	}
	return {
		answers: new Map(
			Object.entries(reply.data.answers).map(([id, probability]) => [
				id,
				Math.min(1, Math.max(0, probability)),
			]),
		),
	};
}

/** How `askSystemOne` sends its request. */
export interface AskOptions extends JudgeOptions {
	/** Sends the request; the global `fetch` when not given. */
	fetch?: typeof fetch;
}

/** Where a judge is reached. */
export interface EndpointOptions {
	/** The provider's own when not given. */
	origin?: string;
	/** Sends the request; the global `fetch` when not given. */
	fetch?: typeof fetch;
}
