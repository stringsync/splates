import { fail } from "../exit";
import type { Handler } from "../server/shared";
import { isTrustBand } from "./band";
import { scopePath } from "./scopes";
import type { TrustStore } from "./store";
import {
	DECISION_KINDS,
	type DecisionKind,
	type DecisionOutcome,
	type DecisionSource,
	type RuleSuggestionView,
	type TrustBand,
	type TrustMode,
	type TrustSetting,
} from "./types";

const SOURCES: readonly DecisionSource[] = [
	"question",
	"plan",
	"mockup",
	"unasked",
	"redo",
	"revert",
];
const OUTCOMES: readonly DecisionOutcome[] = ["kept", "amended", "overturned"];
/** Assumptions a page of the log holds, as the Assumptions tab shows them. */
const ASSUMPTIONS_PAGE = 20;

/**
 * HTTP handlers for `/api/trust` and `/api/trust/decisions`, used by the Trust
 * page, conversation trust widget, and future assumed-pick controls.
 */
export class TrustRoutes {
	constructor(
		private readonly trust: TrustStore,
		/** Whether conversation `id` is still at work on `task`: there, unarchived, and on it. */
		private readonly working: (
			id: string,
			task: string | null,
		) => Promise<boolean> = async () => false,
		/** Pending Backlog rule suggestions across projects, or for one project root. */
		private readonly readSuggestions: (
			project?: string,
		) => Promise<RuleSuggestionView[]> = async () => [],
	) {}

	/** Sets the machine-wide permission to use trust for decisions. */
	readonly setEnabled: Handler = async (request) => {
		const body = await request.json().catch(() => null);
		if (typeof body?.enabled !== "boolean") {
			fail("usage", "enabled must be a boolean");
		}
		await this.trust.setEnabled(body.enabled);
		return Response.json({ enabled: body.enabled });
	};

	/** `GET /api/trust`: lists trust summaries, filterable by `project`, `agent`, `model`. */
	readonly list: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const project = params.get("project") ?? undefined;
		const agent = params.get("agent") ?? undefined;
		const model = params.has("model") ? params.get("model") || null : undefined;
		const scope = scopeFilter(params);
		const [entries, scopes, enabled] = await Promise.all([
			this.trust.list({ project, agent, model, scope }),
			this.trust.scopes(),
			this.trust.enabled(),
		]);
		return Response.json({
			entries,
			enabled,
			scopes: scopes.filter(
				(each) => project === undefined || each.project === project,
			),
		});
	};

	/**
	 * `PUT /api/trust`: updates a project × agent/model trust setting.
	 * Accepts `{ project, agent, model?, scope?, mode?, band?, value?, reset? }`.
	 */
	readonly update: Handler = async (request) => {
		const body = (await request.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (body === null || typeof body !== "object") {
			fail("usage", "request body must be a JSON object");
		}
		const project = body.project;
		const agent = body.agent;
		const model =
			body.model === undefined || body.model === null || body.model === ""
				? null
				: body.model;
		if (typeof project !== "string" || project.trim() === "") {
			fail("usage", "project is required");
		}
		if (typeof agent !== "string" || agent.trim() === "") {
			fail("usage", "agent is required");
		}
		if (model !== null && typeof model !== "string") {
			fail("usage", "model must be a string or null");
		}

		const scope = body.scope;
		if (scope != null && typeof scope !== "string") {
			fail("usage", "scope must be a directory path");
		}
		const key = {
			project,
			agent,
			model,
			...(scope == null ? {} : { scope: scopePath(scope) }),
		};
		let setting: TrustSetting;
		if (body.reset === true) {
			setting = await this.trust.reset(key);
		} else if (body.mode !== undefined) {
			if (body.mode !== "static" && body.mode !== "dynamic") {
				fail(
					"usage",
					`mode must be "static" or "dynamic", got ${String(body.mode)}`,
				);
			}
			let bandOrValue: TrustBand | number | undefined;
			if (body.band !== undefined) {
				if (!isTrustBand(body.band)) {
					fail(
						"usage",
						`band must be "ask-and-wait", "ask-and-go", or "assume", got ${String(body.band)}`,
					);
				}
				bandOrValue = body.band;
			} else if (body.value !== undefined) {
				bandOrValue = Number(body.value);
			}
			setting = await this.trust.setMode(
				key,
				body.mode as TrustMode,
				bandOrValue,
			);
		} else if (body.band !== undefined) {
			if (!isTrustBand(body.band)) {
				fail(
					"usage",
					`band must be "ask-and-wait", "ask-and-go", or "assume", got ${String(body.band)}`,
				);
			}
			setting = await this.trust.setStatic(key, body.band);
		} else if (body.value !== undefined) {
			setting = await this.trust.setValue(key, Number(body.value));
		} else {
			fail("usage", "specify mode, band, value, or reset");
		}

		const entry = await this.trust.entryFor(key);
		return Response.json({ entry, setting });
	};

	/**
	 * `GET /api/trust/conversation`: trust as one conversation sees it, for the
	 * conversation trust widget. Takes `conversation`, and the `project`,
	 * `agent` and `model` it runs as now.
	 */
	readonly conversation: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const conversation = params.get("conversation") ?? "";
		const project = params.get("project") ?? "";
		const agent = params.get("agent") ?? "";
		if (conversation === "" || project === "" || agent === "") {
			fail("usage", "conversation, project and agent are required");
		}
		const model = params.get("model") || null;
		const [view, enabled] = await Promise.all([
			this.trust.conversation(
				{ project, agent, model },
				conversation,
				params.get("task"),
			),
			this.trust.enabled(),
		]);
		return Response.json({ ...view, enabled });
	};

	readonly setEffects: Handler = async (request) => {
		const body = await request.json().catch(() => null);
		if (
			!Array.isArray(body?.ids) ||
			body.ids.length === 0 ||
			!body.ids.every((id: unknown) => typeof id === "string") ||
			typeof body.undone !== "boolean"
		) {
			fail("usage", "decision ids and an undone flag are required");
		}
		await this.trust.setEffects(body.ids, body.undone);
		return Response.json({ ok: true });
	};

	/** `POST` and `DELETE /api/trust/scopes`: declare or remove a directory. */
	readonly changeScope: Handler = async (request) => {
		const body = (await request.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (typeof body?.project !== "string" || body.project.trim() === "") {
			fail("usage", "project is required");
		}
		if (typeof body.path !== "string") {
			fail("usage", "directory path is required");
		}
		if (request.method === "DELETE") {
			await this.trust.removeScope(body.project, body.path);
		} else {
			await this.trust.addScope(body.project, body.path);
		}
		return this.list(request);
	};

	/** `GET /api/trust/decisions`: lists recent decisions, filterable by project, agent, model, kind, limit. */
	readonly decisions: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const project = params.get("project") ?? undefined;
		const agent = params.get("agent") ?? undefined;
		const model = params.has("model") ? params.get("model") || null : undefined;
		const rawKind = params.get("kind");
		let kind: DecisionKind | undefined;
		if (rawKind !== null && rawKind !== "") {
			if (!DECISION_KINDS.includes(rawKind as DecisionKind)) {
				fail("usage", `unknown decision kind: ${rawKind}`);
			}
			kind = rawKind as DecisionKind;
		}
		const rawLimit = params.get("limit");
		const limit =
			rawLimit === null || rawLimit === ""
				? 100
				: Math.max(1, Math.min(500, Number(rawLimit) || 100));
		const decisions = await this.trust.decisions({
			project,
			agent,
			model,
			kind,
			scope: scopeFilter(params),
			limit,
		});
		return Response.json({ decisions });
	};

	/**
	 * `GET /api/trust/assumptions`: the assumptions log, newest first, by
	 * `page` (from 1) of `limit`, filterable by `project`.
	 */
	readonly assumptions: Handler = async (request) => {
		const params = new URL(request.url).searchParams;
		const project = params.get("project") || undefined;
		const limit = Math.max(
			1,
			Math.min(100, Number(params.get("limit")) || ASSUMPTIONS_PAGE),
		);
		const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
		const { assumptions, total } = await this.trust.assumptions({
			project,
			offset: (page - 1) * limit,
			limit,
		});
		return Response.json({
			assumptions: await Promise.all(
				assumptions.map(async (each) => ({
					...each,
					open:
						each.overturned === null &&
						(await this.working(each.conversation, each.task).catch(
							() => false,
						)),
				})),
			),
			total,
			page,
			pages: Math.max(1, Math.ceil(total / limit)),
		});
	};

	/**
	 * `POST /api/trust/assumptions/wrong`: marks a finished conversation's
	 * assumption wrong, `{ id, instead? }`, recording its overturn.
	 */
	readonly markWrong: Handler = async (request) => {
		const body = (await request.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		const id = body?.id;
		if (typeof id !== "string" || id.trim() === "") {
			fail("usage", "id is required");
		}
		const instead = typeof body?.instead === "string" ? body.instead : "";
		const recorded = await this.trust.markWrong(id, instead);
		return Response.json({ recorded });
	};

	/** `GET /api/trust/suggestions`: lists pending rule suggestion tasks, filterable by `project`. */
	readonly suggestions: Handler = async (request) => {
		const project =
			new URL(request.url).searchParams.get("project") || undefined;
		const suggestions = await this.readSuggestions(project);
		return Response.json({ suggestions });
	};

	/** `POST /api/trust/decisions`: records a decision (e.g. an overturned unasked pick). */
	readonly record: Handler = async (request) => {
		const body = (await request.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		if (body === null || typeof body !== "object") {
			fail("usage", "request body must be a JSON object");
		}
		const {
			project,
			agent,
			model = null,
			kind = "defaults",
			source,
			outcome,
			subject,
			instead,
			conversation = null,
			task = null,
			id,
		} = body;
		if (typeof project !== "string" || project.trim() === "") {
			fail("usage", "project is required");
		}
		if (typeof agent !== "string" || agent.trim() === "") {
			fail("usage", "agent is required");
		}
		if (model !== null && typeof model !== "string") {
			fail("usage", "model must be a string or null");
		}
		if (!DECISION_KINDS.includes(kind as DecisionKind)) {
			fail("usage", `unknown decision kind: ${String(kind)}`);
		}
		if (!SOURCES.includes(source as DecisionSource)) {
			fail("usage", `unknown decision source: ${String(source)}`);
		}
		if (!OUTCOMES.includes(outcome as DecisionOutcome)) {
			fail("usage", `unknown decision outcome: ${String(outcome)}`);
		}
		if (typeof subject !== "string" || subject.trim() === "") {
			fail("usage", "subject is required");
		}
		const at = new Date().toISOString();
		const recorded = await this.trust.record({
			id:
				typeof id === "string" && id.trim() !== ""
					? id
					: `api:${project}:${agent}:${at}:${subject}`,
			at,
			project,
			agent,
			model,
			kind: kind as DecisionKind,
			source: source as DecisionSource,
			outcome: outcome as DecisionOutcome,
			subject,
			...(typeof instead === "string" && instead.trim() !== ""
				? { instead: instead.trim() }
				: {}),
			conversation: typeof conversation === "string" ? conversation : null,
			task: typeof task === "string" ? task : null,
		});
		return Response.json({ recorded });
	};
}

function scopeFilter(params: URLSearchParams): string | null | undefined {
	const scope = params.get("scope");
	return scope === null ? undefined : scope === "" ? null : scopePath(scope);
}
