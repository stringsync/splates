import { useReactive } from "@webappwiz/react";
import {
	PauseIcon,
	PencilIcon,
	PlayIcon,
	TrendingUpIcon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentBrand } from "./agent-icons";
import {
	type Budgets,
	endRaise,
	type ModelChoice,
	pauseBudget,
	type RoleBudget,
	raiseBudget,
	resumeBudget,
	setBudget,
} from "./api";
import { SpendSection } from "./billing-spend";
import { EditForm, ends, PauseForm, RaiseForm } from "./budget-forms";
import { BudgetReading } from "./budget-reading";
import type { ConversationFeed } from "./conversation-feed";
import { ReadFailed, ReadingNow } from "./countdown";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";
import { useReading } from "./page-readings";
import { PHONE_HEADING } from "./phone-rows";
import { ago, limitsOf, PlanLimits, saidAt } from "./plan-limits";
import { TopBar } from "./top-bar";

/** What each model is, under its name. */
const ROLES: Record<RoleBudget["role"], string> = {
	som: "System One models, which a rule asks first",
	llm: "Large language models, for what the som cannot settle",
};

/** The plans whose limits the page shows, by agent id. */
const PLANS = [
	{ agent: "claude", name: "Claude" },
	{ agent: "codex", name: "Codex" },
	{ agent: "opencode", name: "OpenCode" },
	{ agent: "kimi", name: "Kimi" },
];

/**
 * The Billing page: the dollars spent by provider and service, how much of
 * the agent plans is used, and, for each scry model in this project, which
 * model it asks, what its checks may spend, how much of each window is
 * gone, and forms to change the spend, raise it or pause it for a while.
 */
export function BillingPage({ talk }: { talk: ConversationFeed }): JSX.Element {
	const reading = useReading("budgets", () => new BudgetReading());
	const { budgets, error } = useReactive(
		reading,
		({ budgets, error }) => ({ budgets, error }),
		["changed"],
	);
	// Plan limits come first because their cards keep one shape, while the
	// budgets arrive from the CLI a moment later and would shift what is below.
	// Read each time the page is shown, behind the last answer.
	useEffect(() => void reading.refresh(), [reading]);
	const changed = (change: Promise<Budgets>) => reading.changed(change);
	return (
		<section aria-label="billing" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Billing" />
			<SpendSection />
			<PlanSection talk={talk} />
			<div className="flex min-w-0 flex-col gap-4">
				<header className="flex flex-wrap items-center gap-2">
					<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
						Scry budgets
					</h2>
					<span className="text-muted-foreground text-xs">
						Input tokens a check may spend here, on this device.
					</span>
				</header>
				{error !== null && (
					<ReadFailed error={error} onRetry={() => void reading.refresh()} />
				)}
				{budgets === null && error === null && (
					// Each read runs the CLI, which takes a moment.
					<ReadingNow label="Reading budgets…" />
				)}
				{budgets !== null && !budgets.declared && (
					<div className="flex flex-col gap-1 rounded-lg border border-dashed p-4 text-sm">
						<p className="font-medium">No Scry budget yet</p>
						<p className="text-muted-foreground">
							With no budget, scry checks only what code decides and asks no
							model. Choose Edit on a model below and give it an allowance, like
							5m/day, to let its checks run.
						</p>
					</div>
				)}
				{budgets !== null && (
					<ul className="flex flex-col gap-4">
						{budgets.roles.map((role) => (
							<RoleCard
								key={role.role}
								role={role}
								models={budgets.models?.[role.role]}
								onChange={changed}
							/>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

/**
 * The models a role asks at each effort and the config naming each, or that
 * none does and scry's own is used, so nothing is left to guess.
 */
function ModelList({ models }: { models?: ModelChoice[] }): JSX.Element | null {
	if (models === undefined) {
		return null;
	}
	return (
		<dl
			aria-label="models"
			className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b px-4 py-3 text-xs"
		>
			{models.map(({ effort, model, from }) => (
				<div key={effort} className="contents">
					<dt className="text-muted-foreground">{effort}</dt>
					<dd className="min-w-0 truncate">
						{model === null ? (
							<span className="text-muted-foreground">Not set</span>
						) : (
							<>
								<code className="font-mono">{model}</code>{" "}
								<span className="text-muted-foreground">
									{from === null ? "scry's default, none set" : `from ${from}`}
								</span>
							</>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * One model's budget: its spend and where it came from, its windows, its
 * raises, and its pause.
 */
function RoleCard({
	role,
	models,
	onChange,
}: {
	role: RoleBudget;
	models?: ModelChoice[];
	onChange: (change: Promise<Budgets>) => Promise<void>;
}): JSX.Element {
	const now = useMinute();
	const [form, setForm] = useState<"edit" | "raise" | "pause" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const act = (change: Promise<Budgets>) =>
		onChange(change)
			.then(() => {
				setForm(null);
				setError(null);
			})
			.catch((caught: Error) => setError(caught.message));
	const raisable = role.spend !== null && role.spend !== "unlimited";
	// a model that spends nothing asks nothing already
	const pausable = role.spend !== null && role.spend !== "nothing";
	return (
		<li
			aria-label={`${role.role} budget`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
				<div className="flex min-w-0 flex-col">
					<span className="flex items-baseline gap-2">
						<code className="font-medium font-mono text-[13px]">
							{role.role}
						</code>
						<code className="font-mono text-[13px]">
							{role.spend ?? "undeclared"}
						</code>
					</span>
					<span className="text-muted-foreground text-xs">
						{ROLES[role.role]}
					</span>
				</div>
				<div className="ml-auto flex items-center gap-1">
					{role.paused === null ? (
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={form === "pause"}
							disabled={!pausable}
							title={pausable ? undefined : "Asks nothing already"}
							onClick={() => setForm(form === "pause" ? null : "pause")}
						>
							<PauseIcon /> Pause
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => act(resumeBudget(role.role))}
						>
							<PlayIcon /> Resume
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={form === "raise"}
						disabled={!raisable}
						title={raisable ? undefined : "Nothing to raise"}
						onClick={() => setForm(form === "raise" ? null : "raise")}
					>
						<TrendingUpIcon /> Raise
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={form === "edit"}
						onClick={() => setForm(form === "edit" ? null : "edit")}
					>
						<PencilIcon /> Edit
					</Button>
				</div>
			</header>
			<ModelList models={models} />
			<div className="flex flex-col gap-3 px-4 py-3">
				{role.paused !== null && (
					<p
						role="status"
						className="flex items-center gap-2 text-sm text-warning"
					>
						<PauseIcon className="size-3.5" />
						<span>Paused: questions for it go unasked.</span>
						<span className="text-muted-foreground text-xs tabular-nums">
							ends {ends(role.paused.until, now)}
						</span>
					</p>
				)}
				<Windows role={role} />
				{role.raises.length > 0 && (
					<ul aria-label="raises" className="flex flex-col gap-1">
						{role.raises.map((raise) => (
							<li
								key={raise.id}
								className="flex items-center gap-2 text-sm tabular-nums"
							>
								<TrendingUpIcon className="size-3.5 text-primary" />
								<span>+{tokens(raise.tokens)}</span>
								{role.shared && <Reach shared={raise.shared} />}
								<span className="text-muted-foreground text-xs">
									ends {ends(raise.until, now)}
								</span>
								<Button
									variant="ghost"
									size="icon-xs"
									className="ml-auto text-muted-foreground"
									aria-label={`end raise ${raise.id}`}
									onClick={() => act(endRaise(raise.id))}
								>
									<XIcon />
								</Button>
							</li>
						))}
					</ul>
				)}
				{form === "edit" && (
					<EditForm
						role={role}
						onSave={(spend) => act(setBudget(role.role, spend))}
						onCancel={() => setForm(null)}
					/>
				)}
				{form === "raise" && (
					<RaiseForm
						shared={role.shared}
						onRaise={(amount, span, opts) =>
							act(raiseBudget(role.role, amount, span, opts))
						}
						onCancel={() => setForm(null)}
					/>
				)}
				{form === "pause" && (
					<PauseForm
						onPause={(span) => act(pauseBudget(role.role, span))}
						onCancel={() => setForm(null)}
					/>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{role.set
						? role.shared
							? "Set here, over the configs, and held to the limits every project shares too."
							: "Set here, over the configs."
						: role.from === null
							? "No config declares it."
							: role.shared
								? `From ${home(role.from)}, shared by every project.`
								: `From ${home(role.from)}.`}
				</p>
			</div>
		</li>
	);
}

/** Each window of a role's budget as a bar, or what it spends without one. */
function Windows({ role }: { role: RoleBudget }): JSX.Element {
	if (role.standing.length === 0) {
		return (
			<p className="text-sm">
				{role.spend === "unlimited"
					? "Spends without a limit."
					: role.spend === "nothing"
						? "Asks nothing: questions for it go unasked."
						: "Asks nothing until a budget is set."}
			</p>
		);
	}
	return (
		<ul
			className={cn(
				"grid items-center gap-x-3 gap-y-2 max-md:gap-y-4",
				METER_COLUMNS,
			)}
		>
			{role.standing.map((each) => {
				const used = each.tokens === 0 ? 1 : each.spent / each.tokens;
				const tone = toneOf(used);
				return (
					// a role set here over a shared budget has each window twice
					<li
						key={`${each.shared}:${each.window}`}
						aria-label={each.shared ? `${each.window}, shared` : each.window}
						className="col-span-full grid grid-cols-subgrid items-center text-sm max-md:gap-y-2 tabular-nums"
					>
						<span className="flex items-center gap-1.5 whitespace-nowrap">
							<span className="first-letter:uppercase">{each.window}</span>
							{each.shared && <Reach shared />}
						</span>
						<Meter
							used={used}
							className="max-md:col-span-full max-md:row-start-2"
						/>
						<span
							className={cn(
								"text-right max-md:col-start-2 max-md:row-start-1",
								tone === "warning" && "text-warning",
								tone === "destructive" && "text-destructive",
							)}
						>
							{tokens(each.spent)} of {tokens(each.tokens)}
							{each.raised > 0 && (
								// The raise list says it too, where a phone has no room.
								<span className="text-muted-foreground text-xs max-md:hidden">
									{" "}
									(+{tokens(each.raised)})
								</span>
							)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

/** Whom a shared budget's window or raise counts: every project, or this one. */
function Reach({ shared }: { shared: boolean }): JSX.Element {
	return (
		<span
			title={
				shared
					? "Shared by every project, from your own config"
					: "For this project only"
			}
			className="inline-flex items-center gap-1 text-muted-foreground text-xs"
		>
			{shared && <UsersIcon className="size-3" />}
			{shared ? "every project" : "this project"}
		</span>
	);
}

/** How much of the agent plans is used, as each agent last said. */
function PlanSection({ talk }: { talk: ConversationFeed }): JSX.Element {
	const { agents, conversations } = useReactive(
		talk,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	const now = useMinute();
	// Codex and Kimi never send their limits, so the server asks them as the page opens.
	useEffect(() => void talk.refreshLimits(), [talk]);
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<header className="flex flex-wrap items-center gap-2">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
					Plan limits
				</h2>
				<span className="text-muted-foreground text-xs">
					As each agent last said, from any project.
				</span>
			</header>
			<ul className="flex flex-col gap-4">
				{PLANS.map(({ agent, name }) => {
					const limits = limitsOf(agents, conversations, agent);
					const at = saidAt(limits);
					return (
						<li
							key={agent}
							aria-label={`${name} plan`}
							className="rounded-xl border bg-card px-4 py-3 shadow-xs"
						>
							<div className="flex flex-wrap items-baseline gap-x-2">
								<AgentBrand agent={agent} name={name} className="text-sm" />
								{at !== null && (
									<span className="text-muted-foreground text-xs">
										said {ago(at, now)}
									</span>
								)}
							</div>
							{limits.length === 0 ? (
								<p className="mt-2 text-muted-foreground text-sm">
									{agent === "opencode" ? (
										"No plan limits reported by OpenCode. Check your provider for remaining quota."
									) : (
										<>
											Not said yet: it shows once {name} says, or a conversation
											drives it in splates server.
										</>
									)}
								</p>
							) : (
								<PlanLimits
									limits={limits}
									title={name}
									aligned
									className="mt-2 px-0 [&>h3]:sr-only"
								/>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** Tokens as the CLI says them: 300, 6.5k, 42k, 1.2m, 20m. */
function tokens(count: number): string {
	if (count < 1000) {
		return String(count);
	}
	const [unit, size] = count < 1_000_000 ? ["k", 1000] : ["m", 1_000_000];
	return count < size * 10
		? `${Number((count / size).toFixed(1))}${unit}`
		: `${Math.round(count / size)}${unit}`;
}

/** A path with the home directory as `~`, the way a config is named. */
function home(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
