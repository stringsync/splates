import { useReactive } from "@webappwiz/react";
import {
	PauseIcon,
	PencilIcon,
	PlayIcon,
	TrendingUpIcon,
	XIcon,
} from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { AgentBrand } from "./agent-icons";
import {
	type Budgets,
	endRaise,
	pauseBudget,
	type RoleBudget,
	raiseBudget,
	budgets as readBudgets,
	resumeBudget,
	setBudget,
} from "./api";
import { EditForm, PauseForm, RaiseForm } from "./budget-forms";
import type { ConversationFeed } from "./conversation-feed";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";
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
];

/**
 * The Budget page: how much of the Claude and Codex plans is used, then what
 * scry's checks may spend on each model in this project, with how much of
 * each window is gone and a form to change it, raise it or pause it for a
 * while. Plan limits come first since their cards keep one shape, while the
 * budgets arrive from the CLI a moment later and would shift anything below
 * them.
 */
export function BudgetPage({ talk }: { talk: ConversationFeed }): JSX.Element {
	const [budgets, setBudgets] = useState<Budgets | null>(null);
	const [error, setError] = useState<string | null>(null);
	const read = useCallback(() => {
		readBudgets()
			.then((read) => {
				setBudgets(read);
				setError(null);
			})
			.catch((caught: Error) => setError(caught.message));
	}, []);
	useEffect(read, [read]);
	const changed = (change: Promise<Budgets>) =>
		change.then((read) => {
			setBudgets(read);
			setError(null);
		});
	return (
		<section aria-label="budget" className="flex min-w-0 flex-col gap-8">
			<TopBar title="Budget" />
			<PlanSection talk={talk} />
			<div className="flex flex-col gap-3">
				<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
						Scry budgets
					</h2>
					<span className="text-muted-foreground text-xs">
						Input tokens a check may spend here, on this device.
					</span>
				</header>
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				{budgets === null && error === null && (
					// Each read runs the CLI, which takes a moment.
					<p role="status" className="text-muted-foreground text-sm">
						Reading budgets…
					</p>
				)}
				{budgets !== null && !budgets.declared && (
					<p className="text-muted-foreground text-sm">
						No budget declared, so scry checks only what code decides. Set one
						below.
					</p>
				)}
				{budgets !== null && (
					<ul className="flex flex-col gap-4">
						{budgets.roles.map((role) => (
							<RoleCard key={role.role} role={role} onChange={changed} />
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

/**
 * One model's budget: its spend and where it came from, its windows, its
 * raises, and its pause.
 */
function RoleCard({
	role,
	onChange,
}: {
	role: RoleBudget;
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
						onRaise={(amount, span) =>
							act(raiseBudget(role.role, amount, span))
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
						? "Set here, over the configs."
						: role.from === null
							? "No config declares it."
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
		<ul className={cn("grid items-center gap-x-3 gap-y-2", METER_COLUMNS)}>
			{role.standing.map((each) => {
				const used = each.tokens === 0 ? 1 : each.spent / each.tokens;
				const tone = toneOf(used);
				return (
					<li
						key={each.window}
						aria-label={each.window}
						className="col-span-full grid grid-cols-subgrid items-center text-sm tabular-nums"
					>
						<span className="whitespace-nowrap first-letter:uppercase">
							{each.window}
						</span>
						<Meter used={used} />
						<span
							className={cn(
								"text-right",
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

/** How much of the Claude and Codex plans is used, as each agent last said. */
function PlanSection({ talk }: { talk: ConversationFeed }): JSX.Element {
	const { agents, conversations } = useReactive(
		talk,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	const now = useMinute();
	// Codex never sends its limits, so the server asks it as the page opens.
	useEffect(() => void talk.refreshLimits(), [talk]);
	return (
		<div className="flex flex-col gap-3">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
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
									Not said yet: it shows once {name} says, or a conversation
									drives it in arbor dev.
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

const ENDS = new Intl.DateTimeFormat("en", {
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});

/** When a raise or a pause ends, and how long until then: `Thu 3:00 PM, in 5h`. */
function ends(at: number, now: number): string {
	const hours = Math.max(0, Math.round((at - now) / 3_600_000));
	return `${ENDS.format(at)}, in ${hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`}`;
}

/** A path with the home directory as `~`, the way a config is named. */
function home(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
