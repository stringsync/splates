import type {
	Composed,
	Currents,
	Listing,
	Pick,
	RunState,
	Shippables,
	Supervise,
	Unshipped,
	Waiting,
} from "@splates/server/ship";
import { Duration } from "core/time";
import { ApiError, answered, scoped } from "./request";

/** Every target the registered ship commands serve, and the commands that failed. */
export async function shipTargets({
	fresh = false,
}: {
	/** Wait for a fresh read rather than take the last one the server kept. */
	fresh?: boolean;
} = {}): Promise<Listing> {
	const response = await answered(
		scoped(fresh ? "/api/ship/targets?fresh=1" : "/api/ship/targets"),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/targets: ${response.status}`);
	}
	return (await response.json()) as Listing;
}

/** Each target's current version, by name, for the targets that can say. */
export async function shipCurrent(): Promise<Currents> {
	// Its own route, apart from the targets, as asking a registry can be slow.
	const response = await answered(scoped("/api/ship/current"), {
		within: Duration.mins(1),
	});
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/current: ${response.status}`);
	}
	const body: unknown = await response.json();
	return Object.fromEntries(
		Object.entries(
			typeof body === "object" && body !== null ? body : {},
		).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/** Each target's shippable versions, newest first, for the targets that can say. */
export async function shipVersions(): Promise<Shippables> {
	const response = await answered(scoped("/api/ship/versions"), {
		within: Duration.mins(1),
	});
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/versions: ${response.status}`);
	}
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(body).flatMap(([name, list]) =>
			Array.isArray(list)
				? [
						[
							name,
							list.filter(
								(each): each is { version: string; note?: string } =>
									typeof each === "object" &&
									each !== null &&
									typeof each.version === "string",
							),
						],
					]
				: [],
		),
	);
}

/** Each target's unshipped commit count, by name, for the targets that count them. */
export async function shipUnshipped(): Promise<Unshipped> {
	// Its own route, apart from the targets, as counting can be slow.
	const response = await answered(scoped("/api/ship/unshipped"), {
		within: Duration.mins(2),
	});
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/unshipped: ${response.status}`);
	}
	const body: unknown = await response.json();
	return Object.fromEntries(
		Object.entries(
			typeof body === "object" && body !== null ? body : {},
		).filter(
			(entry): entry is [string, number] => typeof entry[1] === "number",
		),
	);
}

/** One plan of `picks`: the steps in order, and the dependencies left unpicked. */
export async function shipPlan(picks: readonly Pick[]): Promise<Composed> {
	const response = await answered(scoped("/api/ship/plan"), {
		method: "POST",
		// It lists every command, then plans each pick, each with half a minute to answer.
		within: Duration.mins(2),
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ picks }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			"error",
			body.error ?? `/api/ship/plan: ${response.status}`,
		);
	}
	return body as Composed;
}

/** Starts a ship of `picks`: the server composes them again and runs the plan. */
export async function startShip(
	picks: readonly Pick[],
	supervise?: Supervise,
	autoApprove?: boolean,
): Promise<RunState> {
	const response = await answered(scoped("/api/ship/runs"), {
		method: "POST",
		within: Duration.mins(2),
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			picks,
			...(supervise && { supervise }),
			...(autoApprove !== undefined && { autoApprove }),
		}),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			"error",
			body.error ?? `/api/ship/runs: ${response.status}`,
		);
	}
	return body as RunState;
}

/** Every ship run, newest first, or with `running` only the one under way, or the newest `limit`. */
export async function shipRuns({
	running = false,
	limit,
}: {
	running?: boolean;
	limit?: number;
} = {}): Promise<RunState[]> {
	const query = running
		? "?status=running"
		: limit !== undefined
			? `?limit=${limit}`
			: "";
	const response = await answered(scoped(`/api/ship/runs${query}`));
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/runs: ${response.status}`);
	}
	return ((await response.json()) as { runs?: RunState[] }).runs ?? [];
}

/** Run `id` as it stands, or null when there is none by that id. */
export async function shipRun(id: string): Promise<RunState | null> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}`;
	const response = await answered(scoped(path));
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as RunState;
}

/** The address of run `id`'s stream: its state, then each event of it. */
export function shipRunEvents(id: string): string {
	return scoped(`/api/ship/runs/${encodeURIComponent(id)}/events`);
}

/** Sends failed step `step` of `target` in run `id` round again. */
export async function retryShipStep(
	id: string,
	target: string,
	step: string,
): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/retry`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, step }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

/** Stops run `id`: the server ends its steps and records it stopped. */
export async function stopShipRun(id: string): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/stop`;
	const response = await answered(scoped(path), { method: "POST" });
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

/** Stops `target` of run `id` alone: the rest of the run carries on. */
export async function stopShipTarget(
	id: string,
	target: string,
): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/targets/${encodeURIComponent(target)}/stop`;
	const response = await answered(scoped(path), { method: "POST" });
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

/** Sends failed step `step` of `target` in run `id` to an agent, as a board task. */
/** Gives run `id`'s supervisor `fixes` more fixes, switching it on when off. */
export async function superviseShipRun(
	id: string,
	fixes: number,
): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/supervise`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ fixes }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

/** Switches run `id`'s auto-approving of Yes/No prompts on or off. */
export async function autoApproveShipRun(
	id: string,
	on: boolean,
): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/auto-approve`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ on }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

export async function sendShipStep(
	id: string,
	target: string,
	step: string,
): Promise<{ state: RunState; task: number }> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/send`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, step }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
		state?: RunState;
		task?: number;
	};
	if (!response.ok || body.state === undefined || body.task === undefined) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return { state: body.state, task: body.task };
}

/** Sends `target`'s recap to an agent, with the usual time of each slow step by id. */
export async function sendShipTarget(
	id: string,
	target: string,
	slow: Record<string, number>,
): Promise<{ state: RunState; task: number }> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/send-target`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, slow }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
		state?: RunState;
		task?: number;
	};
	if (!response.ok || body.state === undefined || body.task === undefined) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return { state: body.state, task: body.task };
}

/** Answers prompt `prompt` that step `step` of `target` in run `id` waits on. */
export async function answerShipPrompt(
	id: string,
	target: string,
	step: string,
	prompt: string,
	value: unknown,
): Promise<RunState> {
	const path = `/api/ship/runs/${encodeURIComponent(id)}/answer`;
	const response = await answered(scoped(path), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, step, prompt, value }),
	});
	const body = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.error ?? `${path}: ${response.status}`);
	}
	return body as RunState;
}

/** Every prompt a ship run has open, waiting on the user. */
export async function shipWaiting(): Promise<Waiting[]> {
	const response = await answered(scoped("/api/ship/waiting"));
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/waiting: ${response.status}`);
	}
	return (await response.json()) as Waiting[];
}
