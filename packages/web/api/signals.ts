import type { SignalOverview } from "@splates/server/signals";
import { Duration } from "core/time";
import { ApiError, answered, scoped, send, sendJson } from "./request";

/** Every signal on the server, across projects, and how many live subscribers they have. */
export interface Signals {
	signals: SignalOverview[];
	subscribers: number;
}

/** Reads every signal with a raise, a probe or a subscriber. */
export async function signals(): Promise<Signals> {
	const response = await answered("/api/signals");
	const body = (await response.json().catch(() => ({}))) as Partial<Signals> & {
		reason?: string;
		message?: string;
	};
	if (!response.ok || body.signals === undefined) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/signals: ${response.status}`,
		);
	}
	return { signals: body.signals, subscribers: body.subscribers ?? 0 };
}

/** Stops the probe on signal `name`. */
export async function stopProbe(name: string): Promise<void> {
	await send("/api/signals/probe-stop", {
		body: JSON.stringify({ name }),
		headers: { "Content-Type": "application/json" },
	});
}

/** Runs the poll script on signal `name` now; resolves once the run is done. */
export async function pollNow(name: string): Promise<void> {
	await send("/api/signals/poll-now", {
		body: JSON.stringify({ name }),
		headers: { "Content-Type": "application/json" },
	});
}

/** Ends wait `wait` of `conversation`, as the person's Stop waiting does. */
export async function stopWait(
	conversation: string,
	wait: string,
): Promise<void> {
	await send(
		`/api/conversations/${encodeURIComponent(conversation)}/signal-wait/${encodeURIComponent(wait)}/stop`,
		{},
	);
}

/** Pauses automation `id` of project `project`, so it no longer subscribes. */
export async function pauseSubscription(
	project: string,
	id: string,
): Promise<void> {
	await send(
		scoped(`/api/automations/${encodeURIComponent(id)}/pause`, project),
		{ method: "PUT" },
	);
}

/** A signal's check as the form writes it: a command run every so often until a timeout. */
export interface CheckForm {
	/** The signal, `<project>.<name>`. */
	name: string;
	description: string;
	/** The shell command; exit 0 means the condition holds. */
	script: string;
	/** Between runs, as `30s`, `5m` or `1h`. */
	every: string;
	/** Until it gives up, as `30m`, `6h` or `1d`. */
	timeout: string;
}

/** What one test run of a check's command did. */
export interface CheckTest {
	exit: number;
	output: string;
	ms: number;
}

/** Starts, or restarts, the check on its signal's probe. */
export async function saveCheck(form: CheckForm): Promise<void> {
	await sendJson("/api/signals/check", "POST", form);
}

/** Runs the command once where the check would, raising nothing. */
export async function testCheck(
	name: string,
	script: string,
): Promise<CheckTest> {
	return (await sendJson(
		"/api/signals/check-test",
		"POST",
		{ name, script },
		Duration.mins(3),
	)) as CheckTest;
}

/** Sets a duration/date deadline, or clears it with null. */
export async function saveExpiration(
	name: string,
	expires: string | null,
): Promise<void> {
	await sendJson("/api/signals/expiration", "POST", { name, expires });
}
