import type {
	RuleSuggestionView,
	TrustBand,
	TrustEntry,
	TrustKey,
	TrustScope,
} from "@splates/server/trust";
import {
	bandOf,
	KIND_LABELS,
	TRUST_BANDS,
	TRUST_MILESTONES,
} from "@splates/server/trust/browser";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Card } from "#web/components/ui/card.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
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
import { PageSection } from "./page-section";
import { TopBar } from "./top-bar";
import { TrustAssumptions } from "./trust-assumptions";
import { BAND_META, BandBadge, ScopeChip } from "./trust-badges";
import { TrustHowItWorks } from "./trust-how-it-works";
import { TrustRuleSuggestions } from "./trust-rule-suggestions";
import { TrustScopes } from "./trust-scopes";

/**
 * The Trust page, at `#trust`: every project × agent/model's earned autonomy
 * level, milestone standing, and Auto or pinned level override.
 */
export function TrustPage(): JSX.Element {
	const [overview, setOverview] = useState<TrustOverview | null>(null);
	const [suggestions, setSuggestions] = useState<RuleSuggestionView[]>([]);
	const [failed, setFailed] = useState<string | null>(null);
	const [project, setProject] = useState<string | null>(null);
	const [tab, setTab] = useState("models");
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
		<Tabs
			value={tab}
			onValueChange={setTab}
			aria-label="trust"
			className="min-w-0 gap-5"
		>
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
			{overview !== null && tab === "models" && (
				<Card className="flex items-center justify-between gap-4 px-4 py-3">
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
				</Card>
			)}
			{failed !== null && (
				<p role="alert" className="text-destructive text-sm">
					{failed}
				</p>
			)}
			{projects.length > 0 && tab !== "key" && (
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

/** `All projects`, then one filter button per project, matching StatsPage. */
function ProjectChips({
	projects,
	picked,
	onPick,
}: {
	projects: string[];
	picked: string | null;
	onPick: (project: string | null) => void;
}): JSX.Element {
	const chip = (label: string, value: string | null) => {
		const active = picked === value;
		return (
			<Button
				key={value ?? ""}
				type="button"
				role="radio"
				aria-checked={active}
				variant={active ? "secondary" : "ghost"}
				size="sm"
				onClick={() => onPick(value)}
			>
				{label}
			</Button>
		);
	};
	return (
		<div
			role="radiogroup"
			aria-label="Projects"
			className="flex flex-wrap items-center gap-1"
		>
			{chip("All projects", null)}
			{projects.map((path) => chip(projectName(path), path))}
		</div>
	);
}

/** One project's section and its models, each in a card of its own. */
function ProjectModels({
	enabled,
	path,
	models,
	scoped,
	onChange,
}: {
	enabled: boolean;
	path: string;
	models: TrustEntry[];
	scoped: Map<string, TrustEntry[]>;
	onChange: (key: TrustKey, how: TrustChange) => Promise<void>;
}): JSX.Element {
	return (
		<PageSection
			aria-label={projectName(path)}
			title={<span title={path}>{projectName(path)}</span>}
			count={`${models.length} ${models.length === 1 ? "model" : "models"}`}
		>
			{models.map((entry) => {
				const id = idOf(entry);
				return (
					<ModelCard
						enabled={enabled}
						key={id}
						entry={entry}
						scopes={scoped.get(id) ?? []}
						onChange={onChange}
					/>
				);
			})}
		</PageSection>
	);
}

/** A model's card: its effective level, earned standing, override dropdown, and nested scope rows. */
function ModelCard({
	enabled,
	entry,
	scopes,
	onChange,
}: {
	enabled: boolean;
	entry: TrustEntry;
	scopes: TrustEntry[];
	onChange: (key: TrustKey, how: TrustChange) => Promise<void>;
}): JSX.Element {
	return (
		<Card render={<article />} aria-label={modelName(entry)}>
			{[entry, ...scopes].map((row) => (
				<ModelRow
					key={idOf(row)}
					entry={row}
					enabled={enabled}
					onChange={(how) => onChange(keyOf(row), how)}
				/>
			))}
		</Card>
	);
}

type OverrideSelection =
	| { mode: "dynamic" }
	| { mode: "static"; band: TrustBand };

function savedSelection(entry: TrustEntry): OverrideSelection {
	return entry.mode === "static"
		? { mode: "static", band: entry.pinnedBand ?? bandOf(entry) }
		: { mode: "dynamic" };
}

function sameSelection(
	left: OverrideSelection,
	right: OverrideSelection,
): boolean {
	return (
		left.mode === right.mode &&
		(left.mode === "dynamic" ||
			(right.mode === "static" && left.band === right.band))
	);
}

function ModelRow({
	enabled,
	entry,
	onChange,
}: {
	enabled: boolean;
	entry: TrustEntry;
	onChange: (how: TrustChange) => Promise<void>;
}): JSX.Element {
	const scope = entry.scope;
	const saved = savedSelection(entry);
	const [staged, setStaged] = useState<OverrideSelection | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setStaged(null);
		setMenuOpen(false);
		setResetting(false);
	}, []);

	const active = staged ?? saved;
	const dirty = staged !== null && !sameSelection(staged, saved);
	const effectiveBand = bandOf(entry, enabled);
	const triggerLabel =
		active.mode === "dynamic" ? "Auto" : BAND_META[active.band].label;
	const menuValue = active.mode === "dynamic" ? "auto" : active.band;

	const apply = async () => {
		if (!dirty || staged === null) {
			return;
		}
		setSaving(true);
		try {
			await onChange(
				staged.mode === "dynamic"
					? { mode: "dynamic" }
					: { mode: "static", band: staged.band },
			);
			setStaged(null);
		} finally {
			setSaving(false);
		}
	};

	const confirmReset = async () => {
		setSaving(true);
		try {
			await onChange({ reset: true });
			setResetting(false);
			setStaged(null);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			className={cn(
				"flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
				scope !== undefined && "border-t bg-muted/20 sm:pl-[53px]",
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-2.5">
				{scope === undefined && (
					<span className="mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-md bg-muted">
						<AgentMark agent={entry.agent} />
					</span>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						{scope === undefined ? (
							<span className="font-medium text-sm">{modelName(entry)}</span>
						) : (
							<ScopeChip path={scope} />
						)}
						<BandBadge band={effectiveBand} />
						{entry.mode === "static" && <Badge variant="outline">Pinned</Badge>}
					</div>
					<p className="mt-0.5 text-muted-foreground text-xs tabular-nums leading-snug">
						{standingText(entry)}
					</p>
				</div>
			</div>
			<div
				className={cn(
					"flex shrink-0 flex-wrap items-center gap-1.5",
					scope === undefined && "pl-[36px] sm:pl-0",
				)}
			>
				{resetting ? (
					<>
						<span className="text-muted-foreground text-xs">
							{entry.standing.sessions > 0
								? `Forget ${entry.standing.sessions} ${entry.standing.sessions === 1 ? "session" : "sessions"}?`
								: "Reset history?"}
						</span>
						<Button
							type="button"
							size="sm"
							variant="destructive"
							disabled={saving}
							onClick={() => void confirmReset()}
						>
							Reset
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={saving}
							onClick={() => setResetting(false)}
						>
							Cancel
						</Button>
					</>
				) : (
					<>
						<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
							<DropdownMenuTrigger
								render={
									<Button
										type="button"
										variant="outline"
										size="sm"
										aria-label={`${scope ?? modelName(entry)} trust level`}
										disabled={saving}
										className={cn(
											"min-w-[112px] justify-between gap-2 px-2.5 font-medium text-xs",
											dirty && "border-foreground",
										)}
									/>
								}
							>
								<span>{triggerLabel}</span>
								<ChevronDownIcon
									aria-hidden
									className="size-3.5 text-muted-foreground"
								/>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-48">
								<DropdownMenuRadioGroup
									value={menuValue}
									onValueChange={(next) => {
										const picked: OverrideSelection =
											next === "auto"
												? { mode: "dynamic" }
												: { mode: "static", band: next as TrustBand };
										setStaged(sameSelection(picked, saved) ? null : picked);
										setMenuOpen(false);
									}}
								>
									<DropdownMenuRadioItem closeOnClick value="auto">
										Auto (earned)
									</DropdownMenuRadioItem>
									{TRUST_BANDS.map((band) => (
										<DropdownMenuRadioItem closeOnClick key={band} value={band}>
											{BAND_META[band].label}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={() => {
										setStaged(null);
										setResetting(true);
									}}
								>
									Reset history…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						{dirty && (
							<>
								<Button
									type="button"
									size="sm"
									disabled={saving}
									onClick={() => void apply()}
								>
									Apply
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									disabled={saving}
									aria-label="Cancel change"
									title="Cancel change"
									onClick={() => setStaged(null)}
								>
									<XIcon />
								</Button>
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/** Formats the milestone standing line shown under a model or scope row. */
export function standingText(entry: TrustEntry): string {
	const { earnedBand, mode, standing, asking } = entry;
	const prefix =
		mode === "static"
			? `Earned ${BAND_META[earnedBand].label}`
			: earnedBand === "ask-and-wait"
				? `Toward ${BAND_META["ask-and-go"].label}`
				: earnedBand === "ask-and-go"
					? `Toward ${BAND_META.assume.label}`
					: "Earned";

	const sessionsText =
		earnedBand === "ask-and-wait"
			? `${standing.sessions}/${TRUST_MILESTONES.askAndGo.sessions} sessions`
			: earnedBand === "ask-and-go"
				? `${standing.sessions}/${TRUST_MILESTONES.assume.sessions} sessions`
				: `${standing.sessions} ${standing.sessions === 1 ? "session" : "sessions"}`;

	const daysText =
		earnedBand === "ask-and-wait"
			? `${standing.activeDays}/${TRUST_MILESTONES.askAndGo.activeDays} days`
			: earnedBand === "ask-and-go"
				? `${standing.activeDays}/${TRUST_MILESTONES.assume.activeDays} days`
				: `${standing.activeDays} ${standing.activeDays === 1 ? "day" : "days"}`;

	const parts = [prefix, sessionsText, daysText];
	if (standing.agreement !== null) {
		parts.push(`${standing.agreement}% agreed`);
	}
	if (asking.length > 0) {
		parts.push(
			`asks first on ${asking.map((kind) => KIND_LABELS[kind]).join(", ")}`,
		);
	}
	return parts.join(" · ");
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
