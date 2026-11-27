import type { ConversationState } from "../conversations";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Document, Log, Storage } from "../storage";
import { askingKinds, bandOf } from "./band";
import {
	extractAssumptions,
	extractConversationDecisions,
	overturnOf,
	parseRevertCommit,
} from "./extract";
import {
	type ScopeDeclaration,
	scopedDecisions,
	scopeFor,
	scopePath,
	type TrustScope,
	type TrustTaskFiles,
	taskFilesKey,
} from "./scopes";
import {
	conversationDecisions,
	NEUTRAL_TRUST,
	type ScoredDecision,
	summarizeTrust,
} from "./score";
import {
	type AssumptionView,
	type DecisionKind,
	type TrustAssumption,
	type TrustDecision,
	type TrustEntry,
	type TrustKey,
	type TrustMode,
	type TrustPosture,
	type TrustSetting,
	trustKey,
} from "./types";

interface TrustSettingsFile {
	enabled?: boolean;
	settings: Record<string, TrustSetting>;
	scopes?: ScopeDeclaration[];
}

/**
 * Machine-wide store for agent decision history (`~/.splates/trust-decisions.jsonl`)
 * and per project × agent/model trust settings (`~/.splates/trust-settings.json`).
 */
export class TrustStore {
	readonly decisionsLog: Log<TrustDecision>;
	private readonly effects: Log<{ ids: string[]; undone: boolean }>;
	readonly settingsDoc: Document<TrustSettingsFile>;
	readonly assumptionsLog: Log<TrustAssumption>;
	private readonly taskFiles: Document<Record<string, TrustTaskFiles[]>>;
	/** Cached decision ids already written, avoiding duplicate appends. */
	private knownIds: Set<string> | null = null;
	/** Cached assumption ids already written. */
	private knownAssumptions: Set<string> | null = null;

	constructor(storage: Storage) {
		this.decisionsLog = storage.log("trust-decisions.jsonl");
		this.effects = storage.log("trust-effects.jsonl");
		this.settingsDoc = storage.document("trust-settings.json");
		this.assumptionsLog = storage.log("trust-assumptions.jsonl");
		this.taskFiles = storage.document("trust-task-files.json");
	}

	/** Project directories currently declared on the Trust page. */
	async scopes(): Promise<TrustScope[]> {
		const { scopes = [] } = (await this.settingsDoc.read()) ?? {};
		return scopes
			.filter((each) => each.removedAt === null)
			.map(({ project, path }) => ({ project, path }));
	}

	async addScope(
		project: string,
		input: string,
		at = new Date().toISOString(),
	): Promise<void> {
		const path = scopePath(input);
		await this.settingsDoc.update((current) => {
			const file = current ?? { settings: {} };
			const scopes = file.scopes ?? [];
			if (
				scopes.some(
					(each) =>
						each.project === project &&
						each.path === path &&
						each.removedAt === null,
				)
			) {
				return file;
			}
			return {
				...file,
				scopes: [...scopes, { project, path, addedAt: at, removedAt: null }],
			};
		});
	}

	async removeScope(
		project: string,
		input: string,
		at = new Date().toISOString(),
	): Promise<void> {
		const path = scopePath(input);
		await this.settingsDoc.update((current) => {
			const file = current ?? { settings: {} };
			return {
				...file,
				scopes: (file.scopes ?? []).map((each) =>
					each.project === project &&
					each.path === path &&
					each.removedAt === null
						? { ...each, removedAt: at }
						: each,
				),
			};
		});
	}

	/** Includes removed scopes, whose earlier decisions can still need their task's diff. */
	async hasScopeHistory(project: string): Promise<boolean> {
		const file = await this.settingsDoc.read();
		return file?.scopes?.some((each) => each.project === project) ?? false;
	}

	/** The current trust bucket for work with known changed paths. */
	async keyForFiles(
		key: TrustKey,
		files: readonly string[],
		at = new Date().toISOString(),
	): Promise<TrustKey> {
		if (files.length === 0) {
			return key;
		}
		const file = await this.settingsDoc.read();
		const scopes =
			file?.scopes?.filter((each) => each.project === key.project) ?? [];
		const scope = scopeFor(files, scopes, at);
		return scope === undefined ? key : { ...key, scope };
	}

	/**
	 * The posture of work at `key`, in the scope its changed `files` fall in
	 * when the project has scopes; `files` is read only then, and null keeps
	 * `key`'s own scope.
	 */
	async postureOfWork(
		key: TrustKey,
		files: () => Promise<readonly string[] | null>,
	): Promise<TrustPosture> {
		const scoped = (await this.hasScopeHistory(key.project))
			? await this.keyForFiles(key, (await files()) ?? [])
			: key;
		return this.posture(scoped);
	}

	/** Keep the latest diff per task attempt, even for decisions answered before the first edit. */
	async rememberTaskFiles(snapshot: TrustTaskFiles): Promise<void> {
		const key = taskFilesKey(snapshot);
		await this.taskFiles.update((current) => {
			const file = current ?? {};
			const attempts = file[key] ?? [];
			const previous = attempts.find(
				(each) => each.startedAt === snapshot.startedAt,
			);
			if (previous?.endedAt != null) {
				return file;
			}
			const next = attempts.filter(
				(each) => each.startedAt !== snapshot.startedAt,
			);
			next.push(snapshot);
			next.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
			return { ...file, [key]: next };
		});
	}

	/** Appends `decision` if its `id` has not been recorded yet. */
	async record(decision: TrustDecision): Promise<boolean> {
		return (await this.recordMany([decision])) > 0;
	}

	/** Appends any decisions in `batch` whose `id` is not yet recorded. */
	async recordMany(batch: readonly TrustDecision[]): Promise<number> {
		if (batch.length === 0) {
			return 0;
		}
		const seen = await this.ids();
		let added = 0;
		for (const decision of batch) {
			if (seen.has(decision.id)) {
				continue;
			}
			await this.decisionsLog.append(decision);
			seen.add(decision.id);
			added += 1;
		}
		return added;
	}

	/** Extracts and records any newly answered decisions in `state`. */
	async observeConversation(
		state: ConversationState,
		project: string,
		at: string = new Date().toISOString(),
	): Promise<number> {
		if (project === "") {
			return 0;
		}
		const extracted = extractConversationDecisions(state, project, at);
		const { assumptions, overturns } = extractAssumptions(state, project, at);
		await this.recordAssumptions(assumptions);
		return this.recordMany([...extracted, ...overturns]);
	}

	/** Appends any of `batch` not yet logged. */
	async recordAssumptions(batch: readonly TrustAssumption[]): Promise<number> {
		if (batch.length === 0) {
			return 0;
		}
		if (this.knownAssumptions === null) {
			const existing = await this.assumptionsLog.replay();
			this.knownAssumptions = new Set(existing.map((each) => each.id));
		}
		let added = 0;
		for (const each of batch) {
			if (this.knownAssumptions.has(each.id)) {
				continue;
			}
			await this.assumptionsLog.append(each);
			this.knownAssumptions.add(each.id);
			added += 1;
		}
		return added;
	}

	/**
	 * Logged assumptions, newest first, each with whether it was overturned,
	 * filtered by project and paged by `offset` and `limit`.
	 */
	async assumptions(
		filter: { project?: string; offset?: number; limit?: number } = {},
	): Promise<{ assumptions: AssumptionView[]; total: number }> {
		const [all, decisions] = await Promise.all([
			this.assumptionsLog.replay(),
			this.decisionsLog.replay(),
		]);
		const overturned = new Map(
			decisions
				.filter((each) => each.id.startsWith("overturn:assumed:"))
				.map((each) => [each.id.slice("overturn:".length), each]),
		);
		const matching = all
			.filter(
				(each) =>
					filter.project === undefined || each.project === filter.project,
			)
			.sort((left, right) => right.at.localeCompare(left.at));
		const offset = filter.offset ?? 0;
		const page = matching.slice(
			offset,
			filter.limit === undefined ? undefined : offset + filter.limit,
		);
		return {
			total: matching.length,
			assumptions: page.map((each) => {
				const decision = overturned.get(each.id);
				return {
					...each,
					overturned:
						decision === undefined
							? null
							: {
									at: decision.at,
									instead: decision.instead ?? each.alternative,
								},
				};
			}),
		};
	}

	/**
	 * Marks the logged assumption `id` wrong, for a conversation that has
	 * finished: the same double-weighted overturn as `[SPLATES OVERTURN <n>]`,
	 * which sends its kind back to asking, without reopening anything.
	 * Returns false when it was already overturned.
	 */
	async markWrong(
		id: string,
		instead = "",
		at: string = new Date().toISOString(),
	): Promise<boolean> {
		const assumed = (await this.assumptionsLog.replay()).find(
			(each) => each.id === id,
		);
		if (assumed === undefined) {
			fail("not_found", `no assumption '${id}'`, { id });
		}
		return this.record(overturnOf(assumed, instead.trim(), at));
	}

	/** Whether trusted decisions are enabled across projects. */
	async enabled(): Promise<boolean> {
		return (await this.settingsDoc.read())?.enabled ?? true;
	}

	async setEnabled(enabled: boolean): Promise<void> {
		await this.settingsDoc.update((current) => ({
			settings: {},
			...current,
			enabled,
		}));
	}

	/**
	 * What an agent at `key` does with a reversible call: its trust, the band
	 * that falls in, and the kinds an overturned assumption sent back to asking.
	 */
	async posture(key: TrustKey): Promise<TrustPosture> {
		const [entry, decisions, enabled] = await Promise.all([
			this.entryFor(key),
			this.decisions(),
			this.enabled(),
		]);
		return {
			entry,
			band: bandOf(entry, enabled),
			asking: enabled ? askingKinds(decisions, key, entry.resetAt) : [],
		};
	}

	/** Records a `redo` task removal as a costly overturn against the model that worked it. */
	async recordRedo(opts: RecordRedoOptions): Promise<boolean> {
		if (opts.agent === null) {
			return false;
		}
		const at = opts.at ?? new Date().toISOString();
		return this.record({
			id: `redo:${opts.project}:${opts.task}:${at}`,
			at,
			project: opts.project,
			agent: opts.agent,
			model: opts.model,
			kind: "design",
			source: "redo",
			outcome: "overturned",
			subject: opts.subject ?? `Removed ${opts.task} for redo`,
			conversation: opts.conversation,
			task: opts.task,
			...(opts.files === undefined ? {} : { files: opts.files }),
		});
	}

	/** Records an unasked pick that the user later overturned. */
	async recordUnaskedOverturn(opts: RecordUnaskedOptions): Promise<boolean> {
		const at = opts.at ?? new Date().toISOString();
		return this.record({
			id:
				opts.id ??
				`unasked:${opts.project}:${opts.agent}:${at}:${opts.subject}`,
			at,
			project: opts.project,
			agent: opts.agent,
			model: opts.model,
			kind: opts.kind ?? "defaults",
			source: "unasked",
			outcome: "overturned",
			subject: opts.subject,
			...(opts.instead === undefined ? {} : { instead: opts.instead }),
			conversation: opts.conversation ?? null,
			task: opts.task ?? null,
		});
	}

	/**
	 * Scans recent commits on `base` (default HEAD) for `git revert` commits
	 * matching previously merged tasks and records a `revert` overturn once per
	 * revert commit SHA.
	 */
	async scanReverts(
		git: Git,
		project: string,
		merged: readonly {
			task: string;
			commit: string | null;
			agent: string | null;
			model: string | null;
			subject?: string;
		}[],
		{
			limit = 50,
			at = new Date().toISOString(),
		}: { limit?: number; at?: string } = {},
	): Promise<number> {
		const withAgent = merged.filter((each) => each.agent !== null);
		if (withAgent.length === 0) {
			return 0;
		}
		const result = await git.run(
			project,
			"log",
			"-n",
			String(limit),
			"--format=%H%x1f%s%x1f%b%x1e",
		);
		if (result.code !== 0 || result.stdout.trim() === "") {
			return 0;
		}
		const hasScopes = await this.hasScopeHistory(project);
		const batch: TrustDecision[] = [];
		for (const raw of result.stdout.split("\x1e")) {
			const trimmed = raw.trim();
			if (trimmed === "") {
				continue;
			}
			const [sha = "", subject = "", body = ""] = trimmed.split("\x1f");
			const parsed = parseRevertCommit(subject, body);
			if (parsed === null) {
				continue;
			}
			const matched = withAgent.find(
				(each) =>
					(parsed.sha !== null &&
						each.commit !== null &&
						(each.commit.startsWith(parsed.sha) ||
							parsed.sha.startsWith(each.commit))) ||
					(parsed.revertedSubject !== null &&
						each.subject !== undefined &&
						each.subject.trim() === parsed.revertedSubject.trim()),
			);
			if (matched === undefined || matched.agent === null) {
				continue;
			}
			const id = `revert:${project}:${sha}`;
			if ((await this.ids()).has(id)) {
				continue;
			}
			const diff = hasScopes
				? await git.run(
						project,
						"diff-tree",
						"--no-commit-id",
						"--name-only",
						"--no-renames",
						"-r",
						"-z",
						sha,
					)
				: null;
			batch.push({
				id,
				at,
				project,
				agent: matched.agent,
				model: matched.model,
				kind: "design",
				source: "revert",
				outcome: "overturned",
				subject: subject.trim(),
				conversation: null,
				task: matched.task,
				...(diff?.code === 0
					? { files: diff.stdout.split("\0").filter(Boolean) }
					: {}),
			});
		}
		return this.recordMany(batch);
	}

	/** Records one requested state for all decisions under the shield. */
	async setEffects(ids: string[], undone: boolean): Promise<void> {
		const known = await this.ids();
		if (ids.some((id) => !known.has(id))) {
			fail("not_found", "unknown trust decision");
		}
		await this.effects.append({ ids, undone });
	}

	private async history(): Promise<TrustDecision[]> {
		const [decisions, changes] = await Promise.all([
			this.decisionsLog.replay(),
			this.effects.replay(),
		]);
		const undone = new Set<string>();
		for (const change of changes) {
			for (const id of change.ids) {
				if (change.undone) {
					undone.add(id);
				} else {
					undone.delete(id);
				}
			}
		}
		return decisions.map((decision) =>
			undone.has(decision.id) ? { ...decision, undone: true } : decision,
		);
	}

	/** Lists recorded decisions, newest first, with optional filters. */
	async decisions(
		filter: {
			project?: string;
			agent?: string;
			model?: string | null;
			kind?: DecisionKind;
			scope?: string | null;
			limit?: number;
		} = {},
	): Promise<TrustDecision[]> {
		const file = await this.settingsDoc.read();
		const all = await this.attributedDecisions(file?.scopes ?? []);
		const filtered = all
			.filter(
				(each) =>
					(filter.project === undefined || each.project === filter.project) &&
					(filter.agent === undefined || each.agent === filter.agent) &&
					(filter.model === undefined || each.model === filter.model) &&
					(filter.kind === undefined || each.kind === filter.kind) &&
					(filter.scope === undefined || (each.scope ?? null) === filter.scope),
			)
			.reverse();
		return filter.limit === undefined
			? filtered
			: filtered.slice(0, filter.limit);
	}

	/** All stored per-model trust settings. */
	async settings(): Promise<TrustSetting[]> {
		const file = await this.settingsDoc.read();
		return Object.values(file?.settings ?? {});
	}

	/** Sets a model's trust to static with `value` (0–100). */
	async setStatic(
		key: TrustKey,
		value: number,
		at: string = new Date().toISOString(),
	): Promise<TrustSetting> {
		assertTrustValue(value);
		return this.upsertSetting(key, (prev) => ({
			...key,
			mode: "static",
			value: Math.round(value),
			dynamicBase: prev?.dynamicBase ?? null,
			dynamicAt: prev?.dynamicAt ?? null,
			resetAt: prev?.resetAt ?? null,
			updatedAt: at,
		}));
	}

	/** Sets a model's dynamic trust starting point to `value` (0–100) without switching to static. */
	async setDynamic(
		key: TrustKey,
		value: number,
		at: string = new Date().toISOString(),
	): Promise<TrustSetting> {
		assertTrustValue(value);
		const rounded = Math.round(value);
		return this.upsertSetting(key, (prev) => ({
			...key,
			mode: "dynamic",
			value: prev?.value ?? rounded,
			dynamicBase: rounded,
			dynamicAt: at,
			resetAt: prev?.resetAt ?? null,
			updatedAt: at,
		}));
	}

	/** Sets a model's trust value (0–100) while keeping its current mode (dynamic by default). */
	async setValue(
		key: TrustKey,
		value: number,
		at: string = new Date().toISOString(),
	): Promise<TrustSetting> {
		assertTrustValue(value);
		const rounded = Math.round(value);
		return this.upsertSetting(key, (prev) => {
			const mode = prev?.mode ?? "dynamic";
			if (mode === "static") {
				return {
					...key,
					mode: "static",
					value: rounded,
					dynamicBase: prev?.dynamicBase ?? null,
					dynamicAt: prev?.dynamicAt ?? null,
					resetAt: prev?.resetAt ?? null,
					updatedAt: at,
				};
			}
			return {
				...key,
				mode: "dynamic",
				value: prev?.value ?? rounded,
				dynamicBase: rounded,
				dynamicAt: at,
				resetAt: prev?.resetAt ?? null,
				updatedAt: at,
			};
		});
	}

	/** Switches a model between `static` and `dynamic` mode (optionally setting its value). */
	async setMode(
		key: TrustKey,
		mode: TrustMode,
		value?: number,
		at: string = new Date().toISOString(),
	): Promise<TrustSetting> {
		if (value !== undefined) {
			assertTrustValue(value);
		}
		if (mode === "dynamic" && value !== undefined) {
			return this.setDynamic(key, value, at);
		}
		const fallback =
			value !== undefined
				? Math.round(value)
				: (await this.entryFor(key)).score;
		return this.upsertSetting(key, (prev) => ({
			...key,
			mode,
			value:
				value !== undefined ? Math.round(value) : (prev?.value ?? fallback),
			dynamicBase: prev?.dynamicBase ?? null,
			dynamicAt: prev?.dynamicAt ?? null,
			resetAt: prev?.resetAt ?? null,
			updatedAt: at,
		}));
	}

	/** Resets a model's trust history (ignoring earlier decisions) and returns to dynamic neutral (50). */
	async reset(
		key: TrustKey,
		at: string = new Date().toISOString(),
	): Promise<TrustSetting> {
		return this.upsertSetting(key, () => ({
			...key,
			mode: "dynamic",
			value: NEUTRAL_TRUST,
			dynamicBase: null,
			dynamicAt: null,
			resetAt: at,
			updatedAt: at,
		}));
	}

	/** Summarizes project defaults and every declared directory for each model. */
	async list(
		filter: {
			project?: string;
			agent?: string;
			model?: string | null;
			scope?: string | null;
		} = {},
	): Promise<TrustEntry[]> {
		const file = await this.settingsDoc.read();
		const decisions = await this.attributedDecisions(file?.scopes ?? []);
		const settings = Object.values(file?.settings ?? {});
		const scopes = Map.groupBy(
			(file?.scopes ?? []).filter((each) => each.removedAt === null),
			(each) => each.project,
		);
		const visible = ({ project, scope }: TrustKey) =>
			scope === undefined ||
			(scopes.get(project) ?? []).some((each) => each.path === scope);
		const models = new Map<string, TrustKey>();
		for (const { project, agent, model } of [...settings, ...decisions]) {
			const key = { project, agent, model };
			models.set(trustKey(key), key);
		}
		const buckets = [...models.values()].flatMap((key) => [
			key,
			...(scopes.get(key.project) ?? []).map(({ path }) => ({
				...key,
				scope: path,
			})),
		]);
		return summarizeTrust(
			decisions.filter(visible),
			settings.filter(visible),
			filter,
			buckets,
		);
	}

	/**
	 * Trust as one conversation sees it: `key`'s entry, the conversation's
	 * decisions with each one's score delta, and their net.
	 */
	async conversation(
		key: TrustKey,
		conversation: string,
		task: string | null = null,
	): Promise<{ entry: TrustEntry; decisions: ScoredDecision[]; net: number }> {
		const snapshots = task === null ? null : await this.taskFiles.read();
		const latest =
			task === null
				? undefined
				: snapshots?.[taskFilesKey({ ...key, task })]?.at(-1);
		const files = latest?.endedAt === null ? latest.files : [];
		const bucket = await this.keyForFiles(key, files);
		const [decisions, settings] = await Promise.all([
			this.decisions().then((each) => each.reverse()),
			this.settings(),
		]);
		return {
			entry:
				summarizeTrust(decisions, settings, {
					...bucket,
					scope: bucket.scope ?? null,
				})[0] ?? (await this.entryFor(bucket)),
			...conversationDecisions(decisions, settings, conversation),
		};
	}

	/** Computes one bucket, including a new model with no decisions yet. */
	async entryFor(key: TrustKey): Promise<TrustEntry> {
		const filter = { ...key, scope: key.scope ?? null };
		const [entry] = await this.list(filter);
		return entry ?? (summarizeTrust([], [], filter, [key])[0] as TrustEntry);
	}

	private async attributedDecisions(
		scopes: readonly ScopeDeclaration[],
	): Promise<TrustDecision[]> {
		const decisions = await this.history();
		return scopes.length === 0
			? decisions
			: scopedDecisions(decisions, scopes, (await this.taskFiles.read()) ?? {});
	}

	private async upsertSetting(
		key: TrustKey,
		update: (previous: TrustSetting | undefined) => TrustSetting,
	): Promise<TrustSetting> {
		const id = trustKey(key);
		let next!: TrustSetting;
		await this.settingsDoc.update((current) => {
			if (
				key.scope !== undefined &&
				!current?.scopes?.some(
					(each) =>
						each.project === key.project &&
						each.path === key.scope &&
						each.removedAt === null,
				)
			) {
				fail("usage", "This directory scope is no longer declared");
			}
			const settings = { ...(current?.settings ?? {}) };
			next = update(settings[id]);
			settings[id] = next;
			return { ...current, settings };
		});
		return next;
	}

	private async ids(): Promise<Set<string>> {
		if (this.knownIds === null) {
			const existing = await this.decisionsLog.replay();
			this.knownIds = new Set(existing.map((each) => each.id));
		}
		return this.knownIds;
	}
}

function assertTrustValue(value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > 100) {
		fail("usage", `trust value must be between 0 and 100, got ${value}`, {
			value,
		});
	}
}

export interface RecordRedoOptions {
	files?: string[];
	project: string;
	agent: string | null;
	model: string | null;
	task: string;
	conversation: string | null;
	subject?: string;
	at?: string;
}

export interface RecordUnaskedOptions {
	project: string;
	agent: string;
	model: string | null;
	kind?: DecisionKind;
	subject: string;
	/** What the user wanted instead of the agent's unasked pick. */
	instead?: string;
	conversation?: string | null;
	task?: string | null;
	at?: string;
	id?: string;
}
