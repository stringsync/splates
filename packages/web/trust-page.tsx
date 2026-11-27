import type {
	DecisionKind,
	RuleSuggestionView,
	TrustEntry,
	TrustKey,
	TrustKindBreakdown,
	TrustScope,
} from "@splates/server/trust";
import { bandOf as bandFor } from "@splates/server/trust/browser";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { queueTodo, removeTodo } from "./api/planning";
import {
	changeTrust,
	changeTrustScope,
	readRuleSuggestions,
	readTrust,
	setTrustEnabled,
	type TrustChange,
	type TrustOverview,
} from "./api/trust";
import { nameOf } from "./billing-sums";
import { useProjects } from "./composer-triggers";
import { TopBar } from "./top-bar";
import { TrustAssumptions } from "./trust-assumptions";
import { TrustHowItWorks } from "./trust-how-it-works";
import { TrustRuleSuggestions } from "./trust-rule-suggestions";
import { TrustScopes } from "./trust-scopes";

/**
 * The Trust page, at `#trust`: every project × agent/model's 0–100 trust,
 * grouped by project, each model a card that opens on its controls (dynamic or
 * static, a pinned value, reset) and its breakdown by kind of decision.
 */
export function TrustPage(): JSX.Element {
	const [overview, setOverview] = useState<TrustOverview | null>(null);
	const [suggestions, setSuggestions] = useState<RuleSuggestionView[]>([]);
	const [failed, setFailed] = useState<string | null>(null);
	const [project, setProject] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const roots = useProjects();
	useEffect(() => {
		readTrust()
			.then((result) => {
				setOverview(result);
				setEnabled(result.enabled);
			})
			.catch((error: unknown) => setFailed(String(error)));
		readRuleSuggestions()
			.then(setSuggestions)
			.catch((error: unknown) => setFailed(String(error)));
	}, []);
	const change = useCallback(async (key: TrustKey, how: TrustChange) => {
		try {
			const entry = await changeTrust(key, how);
			setFailed(null);
			setOverview((now) =>
				now === null ? null : { ...now, entries: replaced(now.entries, entry) },
			);
		} catch (error) {
			setFailed(String(error));
		}
	}, []);
	async function toggle(value: boolean) {
		setSaving(true);
		try {
			await setTrustEnabled(value);
			setEnabled(value);
			setFailed(null);
		} catch (error) {
			setFailed(String(error));
		} finally {
			setSaving(false);
		}
	}
	const dropSuggestion = useCallback((item: RuleSuggestionView) => {
		setSuggestions((now) =>
			now.filter(
				(each) =>
					!(each.project === item.project && each.taskId === item.taskId),
			),
		);
	}, []);
	const queueSuggestion = useCallback(
		async (item: RuleSuggestionView) => {
			await queueTodo(item.taskId, true, item.slug);
			dropSuggestion(item);
		},
		[dropSuggestion],
	);
	const dismissSuggestion = useCallback(
		async (item: RuleSuggestionView) => {
			await removeTodo(item.taskId, item.slug);
			dropSuggestion(item);
		},
		[dropSuggestion],
	);
	const changeScope = async (method: "POST" | "DELETE", scope: TrustScope) => {
		try {
			setOverview(await changeTrustScope(method, scope));
			setFailed(null);
			return true;
		} catch (error) {
			setFailed(String(error));
			return false;
		}
	};
	const entries = overview?.entries ?? [];
	const scopes = overview?.scopes ?? [];
	const projects = [
		...new Set([
			...(roots ?? []).map((each) => each.root),
			...entries.map((each) => each.project),
			...scopes.map((each) => each.project),
			...suggestions.map((each) => each.project),
		]),
	].sort((left, right) => projectName(left).localeCompare(projectName(right)));
	const shown = entries.filter(
		(each) =>
			each.scope === undefined &&
			(project === null || each.project === project),
	);
	const scoped = Map.groupBy(
		entries.filter((each) => each.scope !== undefined),
		(each) => idOf({ ...each, scope: undefined }),
	);
	const shownSuggestions = suggestions.filter(
		(each) => project === null || each.project === project,
	);
	return (
		<Tabs defaultValue="models" aria-label="trust" className="min-w-0 gap-5">
			<TopBar
				title="Trust"
				tabs={
					<TabsList variant="line" aria-label="Trust views">
						<TabsTrigger value="key" className="px-2">
							How it works
						</TabsTrigger>
						<TabsTrigger value="models" className="px-2">
							Models
						</TabsTrigger>
						<TabsTrigger value="scopes" className="px-2">
							Scopes
						</TabsTrigger>
						<TabsTrigger value="assumptions" className="px-2">
							Assumptions
						</TabsTrigger>
					</TabsList>
				}
			/>
			{overview !== null && (
				<div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
					<div>
						<label htmlFor="trust-enabled" className="text-sm font-medium">
							Allow trusted decisions
						</label>
						<p id="trust-scope" className="text-xs text-muted-foreground">
							Applies to every project and model.
						</p>
					</div>
					<Switch
						id="trust-enabled"
						aria-describedby="trust-scope"
						checked={enabled}
						disabled={saving}
						onCheckedChange={toggle}
					/>
				</div>
			)}
			{failed !== null && (
				<p role="alert" className="text-destructive text-sm">
					{failed}
				</p>
			)}
			{projects.length > 0 && (
				<ProjectChips
					projects={projects}
					picked={project}
					onPick={setProject}
				/>
			)}
			{overview === null ? (
				failed === null && (
					<p className="text-muted-foreground text-sm">Reading trust…</p>
				)
			) : (
				<>
					<TabsContent value="models" className="flex flex-col gap-5">
						<TrustRuleSuggestions
							suggestions={shownSuggestions}
							selectedProject={project}
							onQueue={queueSuggestion}
							onDismiss={dismissSuggestion}
						/>
						{shown.length === 0 && shownSuggestions.length === 0 && (
							<p className="text-muted-foreground text-sm">
								No decisions yet. Each model's trust starts once the user keeps
								or overturns one of its picks.
							</p>
						)}
						{group(shown).map(([path, models]) => (
							<ProjectModels
								key={path}
								path={path}
								models={models}
								enabled={enabled}
								scoped={scoped}
								open={open}
								onOpen={setOpen}
								onChange={change}
							/>
						))}
					</TabsContent>
					<TabsContent value="scopes" className="flex flex-col gap-5">
						<TrustScopes
							projects={projects.map((path) => ({
								path,
								name: projectName(path),
							}))}
							selected={project}
							scopes={scopes}
							entries={entries}
							onChange={changeScope}
						/>
					</TabsContent>
					<TabsContent value="assumptions">
						<TrustAssumptions project={project} projects={roots ?? []} />
					</TabsContent>
					<TabsContent value="key">
						<TrustHowItWorks />
					</TabsContent>
				</>
			)}
		</Tabs>
	);
}

/** `All projects`, then a chip for each project, the one shown filled. */
function ProjectChips({
	projects,
	picked,
	onPick,
}: {
	projects: string[];
	picked: string | null;
	onPick: (project: string | null) => void;
}): JSX.Element {
	const chip = (label: string, value: string | null) => (
		<button
			key={value ?? ""}
			type="button"
			aria-pressed={picked === value}
			onClick={() => onPick(value)}
			className={cn(
				"h-9 rounded-full border px-3.5 text-sm",
				picked === value
					? "border-foreground bg-foreground text-background"
					: "bg-card hover:bg-muted",
			)}
		>
			{label}
		</button>
	);
	return (
		<nav aria-label="projects" className="flex flex-wrap gap-2">
			{chip("All projects", null)}
			{projects.map((path) => chip(projectName(path), path))}
		</nav>
	);
}

/** One project's heading and its models, each in a card of its own. */
function ProjectModels({
	enabled,
	path,
	models,
	scoped,
	open,
	onOpen,
	onChange,
}: {
	enabled: boolean;
	path: string;
	models: TrustEntry[];
	scoped: Map<string, TrustEntry[]>;
	open: string | null;
	onOpen: (id: string | null) => void;
	onChange: (key: TrustKey, how: TrustChange) => Promise<void>;
}): JSX.Element {
	return (
		<section aria-label={projectName(path)} className="flex flex-col gap-2.5">
			<div className="flex items-baseline justify-between px-0.5">
				<h2
					title={path}
					className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
				>
					{projectName(path)}
				</h2>
				<span className="text-muted-foreground text-xs">
					{models.length} {models.length === 1 ? "model" : "models"}
				</span>
			</div>
			{models.map((entry) => {
				const id = idOf(entry);
				return (
					<ModelCard
						enabled={enabled}
						key={id}
						entry={entry}
						scopes={scoped.get(id) ?? []}
						open={open}
						onOpen={onOpen}
						onChange={onChange}
					/>
				);
			})}
		</section>
	);
}

/** A model's card: its score and band, opening on its controls and breakdown. */
function ModelCard({
	enabled,
	entry,
	scopes,
	open,
	onOpen,
	onChange,
}: {
	enabled: boolean;
	entry: TrustEntry;
	scopes: TrustEntry[];
	open: string | null;
	onOpen: (id: string | null) => void;
	onChange: (key: TrustKey, how: TrustChange) => Promise<void>;
}): JSX.Element {
	return (
		<article
			aria-label={modelName(entry)}
			className="overflow-hidden rounded-xl border bg-card"
		>
			{[entry, ...scopes].map((row) => {
				const id = idOf(row);
				return (
					<ModelRow
						key={id}
						entry={row}
						enabled={enabled}
						open={open === id}
						onToggle={() => onOpen(open === id ? null : id)}
						onChange={(how) => onChange(keyOf(row), how)}
					/>
				);
			})}
		</article>
	);
}

function ModelRow({
	enabled,
	entry,
	open,
	onToggle,
	onChange,
}: {
	enabled: boolean;
	entry: TrustEntry;
	open: boolean;
	onToggle: () => void;
	onChange: (how: TrustChange) => Promise<void>;
}): JSX.Element {
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	const scope = entry.scope;
	return (
		<>
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				className={cn(
					"flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/40",
					scope !== undefined && "border-t bg-muted/20 pl-9 sm:pl-14",
				)}
			>
				{scope === undefined && (
					<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
						<AgentMark agent={entry.agent} />
					</span>
				)}
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex flex-wrap items-center gap-1.5">
						{scope === undefined ? (
							<span className="font-medium">{modelName(entry)}</span>
						) : (
							<code className="min-w-0 wrap-anywhere rounded-md bg-muted px-1.5 py-0.5">
								{scope}
							</code>
						)}
						<BandPill enabled={enabled} entry={entry} />
						{entry.mode === "static" && <StaticPill />}
					</span>
					<span className="text-muted-foreground text-xs">
						{[
							...(scope === undefined ? ["Project default"] : []),
							entry.mode === "static" ? "Pinned by user" : "Dynamic",
							decisionsOf(entry.counts.total),
						].join(" · ")}
					</span>
				</span>
				<ScoreMeter score={entry.score} className="w-30 max-sm:hidden" />
				<span className="min-w-8 text-right font-semibold text-lg tabular-nums">
					{entry.score}
				</span>
				<Chevron
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
			</button>
			{open && <ModelControls entry={entry} onChange={onChange} />}
		</>
	);
}

/**
 * The controls under an open model: dynamic or static, the value by slider or
 * number (in either mode), reset, and its 5-kind breakdown.
 */
function ModelControls({
	entry,
	onChange,
}: {
	entry: TrustEntry;
	onChange: (how: TrustChange) => Promise<void>;
}): JSX.Element {
	const [value, setValue] = useState(entry.score);
	const [resetting, setResetting] = useState(false);
	useEffect(() => setValue(entry.score), [entry.score]);
	const apply = (next: number) => {
		const clamped = Math.min(100, Math.max(0, Math.round(next)));
		setValue(clamped);
		if (clamped !== entry.score) {
			void onChange({ mode: entry.mode, value: clamped });
		}
	};
	return (
		<div className="flex flex-col gap-3 border-t bg-muted/30 px-3.5 pt-3 pb-3.5">
			<div className="flex flex-wrap items-center gap-2.5">
				<fieldset
					aria-label="mode"
					className="flex rounded-lg border bg-muted p-0.5 text-sm"
				>
					{(["dynamic", "static"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							aria-pressed={entry.mode === mode}
							onClick={() => {
								if (entry.mode !== mode) {
									void onChange(mode === "static" ? { mode, value } : { mode });
								}
							}}
							className={cn(
								"h-9 rounded-md px-3 capitalize sm:h-7",
								entry.mode === mode
									? "bg-card font-medium shadow-xs"
									: "text-muted-foreground",
							)}
						>
							{mode}
						</button>
					))}
				</fieldset>
				<div className="flex min-w-40 flex-1 items-center gap-2.5">
					<input
						type="range"
						aria-label="trust"
						min={0}
						max={100}
						value={value}
						onChange={(event) => setValue(Number(event.target.value))}
						onPointerUp={(event) => apply(Number(event.currentTarget.value))}
						onKeyUp={(event) => apply(Number(event.currentTarget.value))}
						className="h-9 min-w-0 flex-1 accent-foreground"
					/>
					<input
						type="number"
						aria-label="trust value"
						min={0}
						max={100}
						value={value}
						onChange={(event) => setValue(Number(event.target.value))}
						onBlur={(event) => apply(Number(event.currentTarget.value))}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								apply(Number(event.currentTarget.value));
							}
						}}
						className="h-9 w-14 rounded-md border bg-card text-center font-semibold text-sm tabular-nums sm:h-7"
					/>
				</div>
				{resetting ? (
					<span className="flex items-center gap-2">
						<span className="text-muted-foreground text-xs">
							Forget {decisionsOf(entry.counts.total)}?
						</span>
						<Button
							size="sm"
							variant="destructive"
							className="h-9 sm:h-7"
							onClick={() => {
								setResetting(false);
								void onChange({ reset: true });
							}}
						>
							Reset
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-9 sm:h-7"
							onClick={() => setResetting(false)}
						>
							Cancel
						</Button>
					</span>
				) : (
					<Button
						size="sm"
						variant="outline"
						className="h-9 sm:h-7"
						onClick={() => setResetting(true)}
					>
						Reset
					</Button>
				)}
			</div>
			<KindBreakdown kinds={entry.kinds} />
		</div>
	);
}

/** Each kind of decision's kept and overturned counts and its own score. */
function KindBreakdown({
	kinds,
}: {
	kinds: TrustKindBreakdown[];
}): JSX.Element {
	const byKind = new Map(kinds.map((each) => [each.kind, each]));
	return (
		<ul aria-label="by kind" className="grid gap-x-4.5 gap-y-2 md:grid-cols-2">
			{KINDS.map(([kind, label]) => {
				const each = byKind.get(kind);
				const score = each?.score ?? null;
				return (
					<li key={kind} className="flex flex-col gap-1">
						<span className="flex items-center justify-between text-[13px]">
							<span className="font-medium">{label}</span>
							<span className="text-muted-foreground text-xs tabular-nums">
								{each === undefined
									? "No decisions"
									: `${each.counts.kept + each.counts.amended} kept · ${each.counts.overturned} overturned · `}
								{score !== null && <b className="text-foreground">{score}</b>}
							</span>
						</span>
						<ScoreMeter score={score ?? 0} />
					</li>
				);
			})}
		</ul>
	);
}

/** The five kinds in the order the page lists them, with their names. */
const KINDS: [DecisionKind, string][] = [
	["defaults", "Defaults"],
	["design", "API / design"],
	["scope", "Scope / split"],
	["visual", "Visual / UI"],
	["approval", "Approval"],
];

/**
 * What a model's trust lets it do, as agents read it: `Assume` from 90 (with
 * 10 decisions behind a dynamic score), `Ask & go` from 70, else `Ask & wait`.
 */
export function bandOf(
	entry: Pick<TrustEntry, "score" | "mode" | "counts">,
): "assume" | "go" | "wait" {
	const band = bandFor(entry);
	return band === "assume" ? "assume" : band === "ask-and-go" ? "go" : "wait";
}

const BANDS = {
	assume: {
		label: "Assume",
		pill: "bg-success/12 text-success",
		fill: "bg-success",
	},
	go: {
		label: "Ask & go",
		pill: "bg-info/12 text-info",
		fill: "bg-info",
	},
	wait: {
		label: "Ask & wait",
		pill: "bg-warning/15 text-warning",
		fill: "bg-warning",
	},
} as const;

function BandPill({
	enabled,
	entry,
}: {
	enabled: boolean;
	entry: Pick<TrustEntry, "score" | "mode" | "counts">;
}): JSX.Element {
	const band = BANDS[enabled ? bandOf(entry) : "wait"];
	return (
		<span
			className={cn("rounded-full px-2 py-px font-medium text-xs", band.pill)}
		>
			{band.label}
		</span>
	);
}

function StaticPill(): JSX.Element {
	return (
		<span className="rounded-full border px-2 py-px font-medium text-xs">
			Static
		</span>
	);
}

/** A thin bar filled to `score` of 100, in the color of the band the score alone reaches. */
function ScoreMeter({
	score,
	className,
}: {
	score: number;
	className?: string;
}): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"relative block h-1.5 overflow-hidden rounded-full bg-foreground/10",
				className,
			)}
		>
			<span
				className={cn(
					"absolute inset-y-0 left-0 rounded-full",
					BANDS[score >= 90 ? "assume" : score >= 70 ? "go" : "wait"].fill,
				)}
				style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
			/>
		</span>
	);
}

/** Entries grouped by project, by the project's name, each project's models by name. */
function group(entries: TrustEntry[]): [string, TrustEntry[]][] {
	const groups = new Map<string, TrustEntry[]>();
	for (const entry of entries) {
		groups.set(entry.project, [...(groups.get(entry.project) ?? []), entry]);
	}
	return [...groups]
		.sort(([one], [other]) =>
			projectName(one).localeCompare(projectName(other)),
		)
		.map(([path, models]) => [
			path,
			models.toSorted((one, other) =>
				modelName(one).localeCompare(modelName(other)),
			),
		]);
}

/** `entries` with `entry` in place of the one with its key, or added. */
function replaced(entries: TrustEntry[], entry: TrustEntry): TrustEntry[] {
	const id = idOf(entry);
	return entries.some((each) => idOf(each) === id)
		? entries.map((each) => (idOf(each) === id ? entry : each))
		: [...entries, entry];
}

function keyOf({ project, agent, model, scope }: TrustEntry): TrustKey {
	return { project, agent, model, ...(scope === undefined ? {} : { scope }) };
}

function idOf({ project, agent, model, scope }: TrustKey): string {
	return `${project}\0${agent}\0${model ?? ""}\0${scope ?? ""}`;
}

/** A project's name from its main tree's path: the folder's name. */
export function projectName(path: string): string {
	return path.replace(/\/+$/, "").split("/").pop() || path;
}

/** `Claude Opus 4.6`, or the agent's name alone when the model is unknown. */
export function modelName({ agent, model }: TrustKey): string {
	return model === null ? nameOf(agent) : `${nameOf(agent)} ${model}`;
}

function decisionsOf(count: number): string {
	return `${count} ${count === 1 ? "decision" : "decisions"}`;
}
