import { ApiError, answered, scoped, send, sendJson } from "./request";

/**
 * Where a project's scry budgets stand, as `scry budgets --format json`
 * prints it; splates only passes it on, so this mirrors the CLI's type.
 */
export interface Budgets {
	/** Whether any config or change declares budgets. */
	declared: boolean;
	roles: RoleBudget[];
}

/** Where one model's budget stands. */
export interface RoleBudget {
	role: "som" | "llm";
	/** Like `5m/day`, `nothing` or `unlimited`; none when undeclared. */
	spend: string | null;
	/** The config or file that declared it. */
	from: string | null;
	/** Whether it was set here, over the configs. */
	set: boolean;
	standing: {
		/** Like `today` or `the last 7d`. */
		window: string;
		tokens: number;
		raised: number;
		spent: number;
		left: number;
	}[];
	raises: { id: number; tokens: number; from: number; until: number }[];
	/** The pause stopping it asking anything; none when it asks as it may. */
	paused: { from: number; until: number } | null;
}

export async function budgets(): Promise<Budgets> {
	const response = await answered(scoped("/api/budgets"));
	const body = (await response.json().catch(() => ({}))) as Budgets & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/budgets: ${response.status}`,
		);
	}
	return body;
}

/** Sets what `role` may spend here, like `5m/day`; null gives it back to the configs. */
export async function setBudget(
	role: RoleBudget["role"],
	spend: string | null,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}`, "PUT", { spend })) as Budgets;
}

/** Adds `tokens`, like `2m`, to each of `role`'s limits `span`, like `1d`. */
export async function raiseBudget(
	role: RoleBudget["role"],
	tokens: string,
	span: string,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}/raises`, "POST", {
		tokens,
		for: span,
	})) as Budgets;
}

/** Stops `role` asking anything for `span`, like `1d`. */
export async function pauseBudget(
	role: RoleBudget["role"],
	span: string,
): Promise<Budgets> {
	return (await sendJson(`/api/budgets/${role}/pause`, "PUT", {
		for: span,
	})) as Budgets;
}

/** Lets a paused `role` ask again before its pause ends. */
export async function resumeBudget(role: RoleBudget["role"]): Promise<Budgets> {
	return (await send(`/api/budgets/${role}/pause`, {
		method: "DELETE",
	})) as Budgets;
}

export async function endRaise(id: number): Promise<Budgets> {
	return (await send(`/api/budgets/raises/${id}`, {
		method: "DELETE",
	})) as Budgets;
}
