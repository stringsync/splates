import type {
	AssumptionView,
	RuleSuggestionView,
	TrustEntry,
	TrustKey,
	TrustScope,
} from "@splates/server/trust";
import { ApiError, answered, send, sendJson } from "./request";

export interface TrustOverview {
	entries: TrustEntry[];
	scopes: TrustScope[];
	enabled: boolean;
}

/** Every project default and directory trust summary, with the declared scopes. */
export async function readTrust(): Promise<TrustOverview> {
	const response = await answered("/api/trust");
	const body = (await response.json().catch(() => ({}))) as {
		entries?: TrustEntry[];
		scopes?: TrustScope[];
		enabled?: boolean;
		reason?: string;
		message?: string;
	};
	if (!response.ok || body.entries === undefined) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/trust: ${response.status}`,
		);
	}
	return {
		entries: body.entries,
		scopes: body.scopes ?? [],
		enabled: body.enabled ?? true,
	};
}

export async function setTrustEnabled(enabled: boolean): Promise<void> {
	await sendJson("/api/trust/enabled", "PUT", { enabled });
}

/** Pending Backlog rule suggestion tasks paired with the corrections behind each. */
export async function readRuleSuggestions(
	project: string | null = null,
): Promise<RuleSuggestionView[]> {
	const query = project === null ? "" : `?${new URLSearchParams({ project })}`;
	const response = await answered(`/api/trust/suggestions${query}`);
	const body = (await response.json().catch(() => ({}))) as {
		suggestions?: RuleSuggestionView[];
		reason?: string;
		message?: string;
	};
	if (!response.ok || body.suggestions === undefined) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/trust/suggestions: ${response.status}`,
		);
	}
	return body.suggestions;
}

/** What a change to one model's trust does: pin it, set or switch to dynamic, or reset to neutral. */
export type TrustChange =
	| { mode: "static"; value: number }
	| { mode: "dynamic"; value?: number }
	| { reset: true };

/** Changes `key`'s trust as `change` says, answering with its entry after. */
export async function changeTrust(
	key: TrustKey,
	change: TrustChange,
): Promise<TrustEntry> {
	const body = (await sendJson("/api/trust", "PUT", {
		...key,
		...change,
	})) as { entry: TrustEntry };
	return body.entry;
}

/** One page of the assumptions log, newest first. */
export interface AssumptionsPage {
	assumptions: AssumptionView[];
	total: number;
	page: number;
	pages: number;
}

/** Page `page` (from 1) of the calls agents made without asking, in `project` or every one. */
export async function readAssumptions(
	page: number,
	project: string | null,
): Promise<AssumptionsPage> {
	const query = new URLSearchParams({ page: String(page) });
	if (project !== null) {
		query.set("project", project);
	}
	const response = await answered(`/api/trust/assumptions?${query}`);
	const body = (await response.json().catch(() => ({}))) as Partial<
		AssumptionsPage & { reason: string; message: string }
	>;
	if (!response.ok || body.assumptions === undefined) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/trust/assumptions: ${response.status}`,
		);
	}
	return body as AssumptionsPage;
}

/** Marks assumption `id`, in a finished conversation, wrong: an overturn that reopens nothing. */
export async function markAssumptionWrong(id: string): Promise<void> {
	await sendJson("/api/trust/assumptions/wrong", "POST", { id });
}

/** Adds a Backlog task in project `slug` to switch a merged assumption to its alternative. */
export async function queueFollowUp(
	slug: string,
	{ assumed, alternative, task }: AssumptionView,
): Promise<void> {
	const form = new FormData();
	form.set("subject", `Switch ${assumed} to ${alternative}`);
	form.set(
		"text",
		[
			`An agent assumed \`${assumed}\` without asking, and the user wants \`${alternative}\` instead.`,
			"",
			task === null
				? "It was assumed outside a task."
				: `It landed with task \`${task}\`; change what it built on that pick.`,
		].join("\n"),
	);
	await send(`/api/todos?${new URLSearchParams({ project: slug })}`, {
		body: form,
	});
}

/** Declares or removes a directory scope and reloads the trust overview. */
export async function changeTrustScope(
	method: "POST" | "DELETE",
	scope: TrustScope,
): Promise<TrustOverview> {
	return (await sendJson("/api/trust/scopes", method, scope)) as TrustOverview;
}
