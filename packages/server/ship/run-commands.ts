import { fail } from "../exit";
import { DEFAULT_PORT } from "../server/shared";
import { table } from "../table";
import type { ShipContext } from "./commands";
import type { ShipBump } from "./plan";
import type { ShownRun } from "./runs";

/** What the agent asks of the ship run on `splates server`. */
export type RunAction =
	| { do: "start"; projects: string[] }
	| { do: "show" }
	| { do: "set"; project: string; bump?: ShipBump; why?: string }
	| { do: "leave-out"; project: string }
	| { do: "note"; project: string; note: string }
	| { do: "propose" };

/**
 * `splates ship start` and `splates ship plan ...`: asks `splates server`
 * (`dev`, else SPLATES_DEV, else this machine's default port) to change or
 * show the ship run, which refuses a command out of turn. Prints the plan; for
 * `propose`, the card to post. There is no command to approve: only the
 * person's Approve on the page starts a run.
 */
export async function shipRun(
	ctx: Pick<ShipContext, "ps" | "log" | "fetch">,
	action: RunAction,
	{ dev = "", json = false }: { dev?: string; json?: boolean } = {},
): Promise<void> {
	const url = serverUrl(ctx, dev);
	const response = await askServer(
		ctx,
		request(action, ctx.ps.env("SPLATES_CONVERSATION") ?? null),
		url,
	);
	const shown = (await response.json()) as ShownRun | null;
	if (shown === null) {
		fail("not_found", "no ship is planned: `splates ship start <projects>`");
	}
	if (json) {
		ctx.log.info(JSON.stringify(shown));
		return;
	}
	ctx.log.info(`ship ${shown.run.id}: ${shown.run.state}`);
	if (shown.plan !== null) {
		ctx.log.info(
			table(
				["#", "PROJECT", "ACTION", "VERSION", "TAKES", "WHY"],
				shown.plan.steps.map((step, i) => [
					String(i + 1),
					step.slug,
					step.action,
					step.to === null
						? (step.from ?? "-")
						: `${step.from ?? "-"} → ${step.to}`,
					step.takes
						.flatMap((use) => use.pins.map((pin) => pin.name))
						.join(", ") || "-",
					step.why,
				]),
			),
		);
	}
	if (shown.card !== undefined) {
		ctx.log.info(
			`Post this card in your reply, as it is; the person's Approve on it starts the run:\n\n${shown.card}`,
		);
	}
}

function request(
	action: RunAction,
	conversation: string | null,
): [string, string, object | undefined] {
	switch (action.do) {
		case "start":
			return [
				"POST",
				"/api/ship/run",
				{ projects: action.projects, conversation },
			];
		case "show":
			return ["GET", "/api/ship/run", undefined];
		case "set":
			return [
				"POST",
				"/api/ship/run/set",
				{ project: action.project, bump: action.bump, why: action.why },
			];
		case "leave-out":
			return ["POST", "/api/ship/run/leave-out", { project: action.project }];
		case "note":
			return [
				"POST",
				"/api/ship/run/note",
				{ project: action.project, note: action.note },
			];
		case "propose":
			return ["POST", "/api/ship/run/propose", {}];
	}
}

/** Where the `splates server` to ask is: `dev`, else SPLATES_DEV, else this machine's default port. */
export function serverUrl(ctx: Pick<ShipContext, "ps">, dev: string): string {
	return dev || ctx.ps.env("SPLATES_DEV") || `http://localhost:${DEFAULT_PORT}`;
}

/** Asks `url` for `[method, path, body]`, failing as the server's refusal says. */
export async function askServer(
	ctx: Pick<ShipContext, "fetch">,
	[method, path, body]: [string, string, object | undefined],
	url: string,
): Promise<Response> {
	let response: Response;
	try {
		response = await (ctx.fetch ?? fetch)(new URL(path, url).toString(), {
			method,
			// The server refuses a request from any other origin than its own.
			headers: { origin: url, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	} catch (error) {
		fail(
			"not_found",
			`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}; give its URL with --dev`,
		);
	}
	if (!response.ok) {
		fail(
			response.status === 404
				? "not_found"
				: response.status === 409
					? "conflict"
					: "usage",
			`splates server at ${url} refused: ${response.status} ${await response.text()}`,
		);
	}
	return response;
}
