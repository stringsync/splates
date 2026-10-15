import { useReactive } from "@webappwiz/react";
import { PencilIcon, TrendingUpIcon, XIcon } from "lucide-react";
import {
	type FormEvent,
	type JSX,
	useCallback,
	useEffect,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { cn } from "#dev/lib/utils.ts";
import { AgentBrand } from "./agent-icons";
import {
	type Budgets,
	endRaise,
	type RoleBudget,
	raiseBudget,
	budgets as readBudgets,
	setBudget,
} from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";
import { PHONE_HEADING } from "./phone-rows";
import { ago, limitsOf, PlanLimits, saidAt } from "./plan-limits";

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

/** How long a raise can last, as the CLI's `--for` takes it. */
const SPANS = [
	["4h", "4 hours"],
	["1d", "1 day"],
	["3d", "3 days"],
	["1w", "1 week"],
] as const;

/**
 * The Budget page: what scry's checks may spend on each model in this
 * project, with how much of each window is gone, a form to change it or
 * raise it for a while, then how much of the Claude and Codex plans is used.
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
			<PlanSection talk={talk} />
		</section>
	);
}

/** One model's budget: its spend and where it came from, its windows, its raises. */
function RoleCard({
	role,
	onChange,
}: {
	role: RoleBudget;
	onChange: (change: Promise<Budgets>) => Promise<void>;
}): JSX.Element {
	const now = useMinute();
	const [form, setForm] = useState<"edit" | "raise" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const act = (change: Promise<Budgets>) =>
		onChange(change)
			.then(() => {
				setForm(null);
				setError(null);
			})
			.catch((caught: Error) => setError(caught.message));
	const raisable = role.spend !== null && role.spend !== "unlimited";
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

/** What a role may spend, as the CLI writes it, with a way back to the configs. */
function EditForm({
	role,
	onSave,
	onCancel,
}: {
	role: RoleBudget;
	onSave: (spend: string | null) => void;
	onCancel: () => void;
}): JSX.Element {
	const [spend, setSpend] = useState(role.spend ?? "");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSave(spend.trim());
	};
	return (
		<form
			aria-label={`edit ${role.role} budget`}
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<Input
				aria-label="spend"
				value={spend}
				autoFocus
				onChange={(event) => setSpend(event.target.value)}
				placeholder="5m/day"
				className="font-mono max-md:h-10"
			/>
			<p className="text-muted-foreground text-xs">
				<code>nothing</code>, <code>unlimited</code>, or limits joined by
				commas, like <code>5m/day</code> or <code>2m/month,300k/7d</code>.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{role.set && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => onSave(null)}
					>
						Use the configs'
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={spend.trim() === ""}>
					Save
				</Button>
			</div>
		</form>
	);
}

/** More tokens on each of a role's limits, for a while. */
function RaiseForm({
	onRaise,
	onCancel,
}: {
	onRaise: (tokens: string, span: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const [amount, setAmount] = useState("");
	const [span, setSpan] = useState<string>("1d");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onRaise(amount.trim(), span);
	};
	return (
		<form
			aria-label="raise"
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm">Add</span>
				<Input
					aria-label="tokens"
					value={amount}
					autoFocus
					onChange={(event) => setAmount(event.target.value)}
					placeholder="2m"
					className="w-24 font-mono max-md:h-10"
				/>
				<span className="text-sm">tokens for</span>
				<div role="radiogroup" aria-label="for" className="flex gap-1">
					{SPANS.map(([value, label]) => (
						<Button
							key={value}
							type="button"
							role="radio"
							aria-checked={span === value}
							aria-label={label}
							variant={span === value ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setSpan(value)}
						>
							{value}
						</Button>
					))}
				</div>
			</div>
			<p className="text-muted-foreground text-xs">
				Added to each of its limits until the raise ends.
			</p>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={amount.trim() === ""}>
					Raise
				</Button>
			</div>
		</form>
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

/** When a raise ends, and how long until then: `Thu 3:00 PM, in 5h`. */
function ends(at: number, now: number): string {
	const hours = Math.max(0, Math.round((at - now) / 3_600_000));
	return `${ENDS.format(at)}, in ${hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`}`;
}

/** A path with the home directory as `~`, the way a config is named. */
function home(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
