import type { ConversationState } from "@splates/server/conversations";
import { pickedModel } from "@splates/server/models/browser";
import type {
	DecisionKind,
	ScoredDecision,
	TrustEntry,
} from "@splates/server/trust";
import {
	ShieldCheckIcon,
	ShieldIcon,
	ShieldMinusIcon,
	ShieldPlusIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { answered, scoped, sendJson } from "./api/request";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "./components/ui/popover";
import { cn } from "./lib/utils";

/** Trust as one conversation sees it, from `GET /api/trust/conversation`. */
export interface ConversationTrust {
	enabled?: boolean;
	/** The model the conversation runs as now. */
	entry: TrustEntry;
	/** The conversation's own decisions, oldest first, each with its score change. */
	decisions: ScoredDecision[];
	/** The sum of their changes. */
	net: number;
}

/** The open conversation's trust, for its widget and its answered questions' badges. */
export interface ThreadTrust {
	refresh?: () => void;
	/** Null until read. */
	trust: ConversationTrust | null;
	/** The agent's display name. */
	agent: string;
	/** The project's main tree. */
	project: string | null;
}

export const TrustContext = createContext<ThreadTrust>({
	trust: null,
	agent: "",
	project: null,
});

/** What a score lets the model do: assume at 90 up, ask and go from 70, else ask and wait. */
export function band(score: number): {
	name: string;
	bar: string;
} {
	if (score >= 90) {
		return { name: "Assume", bar: "bg-success" };
	}
	if (score >= 70) {
		return { name: "Ask & go", bar: "bg-info" };
	}
	return { name: "Ask & wait", bar: "bg-warning" };
}

/**
 * Reads `conversation`'s trust for the model it runs as in `project`, again
 * whenever it moves on (a turn ends, a reply goes in) or `open` turns true.
 */
export function useConversationTrust(
	conversation: ConversationState,
	project: string | null,
	open: boolean,
	revision = 0,
): ConversationTrust | null {
	const [trust, setTrust] = useState<ConversationTrust | null>(null);
	const model = pickedModel(conversation.settings);
	const moved = `${conversation.status}:${conversation.messages.length}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: read again as the conversation moves on
	useEffect(() => {
		if (project === null) {
			return;
		}
		const query = new URLSearchParams({
			conversation: conversation.id,
			project,
			agent: conversation.agent,
			...(model === null ? {} : { model }),
			...(conversation.task === null ? {} : { task: conversation.task }),
		});
		let current = true;
		answered(scoped(`/api/trust/conversation?${query}`))
			.then((response) =>
				response.ok ? (response.json() as Promise<unknown>) : null,
			)
			.then((read) => {
				if (current && isConversationTrust(read)) {
					setTrust(read);
				}
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [
		conversation.id,
		conversation.agent,
		conversation.task,
		project,
		model,
		moved,
		open,
		revision,
	]);
	return trust;
}

function isConversationTrust(read: unknown): read is ConversationTrust {
	const trust = read as Partial<ConversationTrust> | null;
	return (
		typeof trust === "object" &&
		trust !== null &&
		typeof trust.entry?.score === "number" &&
		Array.isArray(trust.entry.kinds) &&
		Array.isArray(trust.decisions)
	);
}

/** A signed change, `+3` or `−1`, colored green or red, plain when nothing. */
export function Delta({
	delta,
	className,
}: {
	delta: number;
	className?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"tabular-nums",
				delta > 0 && "text-success",
				delta < 0 && "text-destructive",
				className,
			)}
		>
			{signed(delta)}
		</span>
	);
}

function signed(delta: number): string {
	return delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "±0";
}

/**
 * The Trust widget: a row of the model's score and this conversation's net
 * change that opens the breakdown by kind and this conversation's picks, in a
 * popover beside the widgets, or under the row on a phone.
 */
export function TrustCard({ phone }: { phone: boolean }): JSX.Element | null {
	const { trust, agent, project } = useContext(TrustContext);
	const [open, setOpen] = useState(false);
	if (trust === null) {
		return null;
	}
	const row = (
		<>
			<ShieldCheckIcon />
			<span className="min-w-0 flex-1 truncate">Trust</span>
			{trust.decisions.length > 0 && <Delta delta={trust.net} />}
			<span className="font-semibold text-foreground tabular-nums">
				{trust.entry.score}
			</span>
		</>
	);
	const rowClass =
		"flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none [&_svg]:size-4 [&_svg]:text-muted-foreground";
	const details = (
		<TrustDetails trust={trust} agent={agent} project={project} />
	);
	if (phone) {
		return (
			<section
				aria-label="trust"
				data-widget
				className="overflow-hidden rounded-lg border bg-background py-1"
			>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className={rowClass}
				>
					{row}
				</button>
				{open && <div className="mt-1 border-t">{details}</div>}
			</section>
		);
	}
	return (
		<section
			aria-label="trust"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger render={<button type="button" className={rowClass} />}>
					{row}
				</PopoverTrigger>
				<PopoverContent
					side="left"
					align="start"
					sideOffset={12}
					className="w-80 gap-0 p-0"
				>
					{details}
				</PopoverContent>
			</Popover>
		</section>
	);
}

/** The model's score, band and breakdown by kind, then this conversation's picks. */
function TrustDetails({
	trust,
	agent,
	project,
}: {
	trust: ConversationTrust;
	agent: string;
	project: string | null;
}): JSX.Element {
	const { entry, decisions, net } = trust;
	const kinds = KIND_ORDER.map(
		(kind) =>
			entry.kinds.find((each) => each.kind === kind) ?? {
				kind,
				score: 0,
				counts: { kept: 0, amended: 0, overturned: 0, total: 0 },
			},
	);
	return (
		<div className="flex flex-col text-sm">
			<header className="flex items-start gap-2 border-b px-3.5 py-2.5">
				<div className="min-w-0 flex-1">
					<p className="font-medium">
						{[agent, entry.model].filter(Boolean).join(" ")} · {entry.score}
						{decisions.length > 0 && (
							<>
								{" "}
								<span
									className={cn(
										"tabular-nums",
										net > 0 && "text-success",
										net < 0 && "text-destructive",
									)}
								>
									{signed(net)} here
								</span>
							</>
						)}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{[
							project === null ? null : folderOf(project),
							entry.scope,
							entry.mode === "static" ? "Static" : "Dynamic",
							trust.enabled === false ? "Ask & wait" : band(entry.score).name,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
				<a
					href="#trust"
					className="shrink-0 text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
				>
					Trust →
				</a>
			</header>
			<ul
				aria-label="trust by kind"
				className="flex flex-col gap-1.5 px-3.5 py-2.5"
			>
				{kinds.map((each) => (
					<li
						key={each.kind}
						className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs"
					>
						<span className="text-muted-foreground">
							{KIND_NAMES[each.kind]}
						</span>
						<span className="h-1.5 overflow-hidden rounded-full bg-muted">
							<span
								className={cn(
									"block h-full rounded-full",
									band(each.score).bar,
								)}
								style={{ width: `${each.score}%` }}
							/>
						</span>
						<span className="text-right tabular-nums">{each.score}</span>
					</li>
				))}
			</ul>
			{decisions.length > 0 && (
				<section
					aria-label="this conversation"
					className="mx-3.5 flex flex-col gap-1 border-t py-2.5"
				>
					<h4 className="mb-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						This conversation
					</h4>
					<ul className="flex flex-col gap-1">
						{decisions.map((each) => (
							<li key={each.id} className="flex items-baseline gap-2 text-xs">
								<span className="min-w-0 flex-1 truncate" title={each.subject}>
									{pickLine(each)}
									<span className="text-muted-foreground">
										{" "}
										· {KIND_SHORT[each.kind]}
									</span>
								</span>
								<Delta
									delta={each.delta}
									className={cn(
										"shrink-0 whitespace-nowrap font-semibold",
										each.undone && "opacity-60 line-through",
									)}
								/>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

/** What a pick was, and how it was met. */
function pickLine(decision: ScoredDecision): string {
	if (decision.source === "plan") {
		return decision.outcome === "kept"
			? "Plan approved as written"
			: decision.outcome === "amended"
				? "Plan approved with changes"
				: "Plan turned down";
	}
	const pick = decision.picked ?? decision.subject;
	if (decision.outcome === "overturned" && decision.instead !== undefined) {
		return `${pick} → ${decision.instead}`;
	}
	return pick;
}

function folderOf(path: string): string {
	return path.replace(/\/+$/, "").split("/").at(-1) ?? path;
}

/**
 * The shield and net change an event line carries when it moved trust: a
 * green shield-plus and the number for a gain, a red shield-minus for a loss,
 * a muted plain shield and 0 when its decisions net to nothing. The shield
 * carries the sign, so the number shows none; its label says it in full.
 * Given `onToggle`, it opens and closes the change's details.
 */
export function TrustBadge({
	decisions,
	open = false,
	onToggle,
}: {
	decisions: readonly ScoredDecision[];
	open?: boolean;
	onToggle?: () => void;
}): JSX.Element {
	const undone = decisions.every((each) => each.undone);
	const net = decisions.reduce(
		(sum, each) => sum + (undone || !each.undone ? each.delta : 0),
		0,
	);
	const Icon =
		net > 0 ? ShieldPlusIcon : net < 0 ? ShieldMinusIcon : ShieldIcon;
	const label = `Trust ${signed(net)}${undone ? ", undone" : ""}`;
	const className = cn(
		"inline-flex shrink-0 items-center gap-0.5 rounded-sm font-semibold text-[11px] tabular-nums",
		net > 0 && "text-success",
		net < 0 && "text-destructive",
		undone && "opacity-60 line-through",
	);
	const body = (
		<>
			<Icon aria-hidden className="size-3" />
			{Math.abs(net)}
		</>
	);
	if (onToggle === undefined) {
		return (
			<span role="img" aria-label={label} title={label} className={className}>
				{body}
			</span>
		);
	}
	return (
		<button
			type="button"
			aria-expanded={open}
			aria-label={label}
			onClick={onToggle}
			className={cn(
				className,
				"transition-shadow",
				open && "ring-2 ring-foreground/10",
			)}
		>
			{body}
		</button>
	);
}

/** What an answered question line's answers did to trust: the model, its score before and after, and each pick's change. */
export function TrustChange({
	decisions,
	agent,
}: {
	decisions: readonly ScoredDecision[];
	agent: ReactNode;
}): JSX.Element | null {
	const { refresh } = useContext(TrustContext);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const undone = decisions.every((each) => each.undone);
	async function changeEffect() {
		setPending(true);
		setError("");
		try {
			await sendJson("/api/trust/decisions", "PUT", {
				ids: decisions.map((each) => each.id),
				undone: !undone,
			});
			refresh?.();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not update trust",
			);
		} finally {
			setPending(false);
		}
	}
	const first = decisions[0];
	const last = decisions.at(-1);
	if (first === undefined || last === undefined) {
		return null;
	}
	return (
		<section
			aria-label="trust change"
			className="mx-auto mt-1.5 flex w-full max-w-md flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 text-xs"
		>
			<p className="flex items-center justify-between gap-2.5">
				<span className="font-medium text-sm">
					{agent}
					{first.model !== null && ` ${first.model}`}
					<span className="font-normal text-muted-foreground">
						{" "}
						· {folderOf(first.project)}
					</span>
				</span>
				<span className="text-muted-foreground tabular-nums">
					{first.after - (first.undone ? 0 : first.delta)} →{" "}
					<b className="text-foreground">{last.after}</b>
				</span>
			</p>
			<ul className="flex flex-col gap-1">
				{decisions.map((each, at) => (
					<li
						key={each.id}
						className="flex items-center justify-between gap-2.5"
					>
						<span className="min-w-0 text-muted-foreground">
							{decisions.length > 1 && `${at + 1}. `}
							{pickLine(each)} · {KIND_NAMES[each.kind]} ({outcomeWord(each)})
						</span>
						<Delta
							delta={each.delta}
							className={cn(
								"shrink-0 whitespace-nowrap font-semibold",
								each.undone && "opacity-60 line-through",
							)}
						/>
					</li>
				))}
			</ul>
			<button
				type="button"
				disabled={pending}
				onClick={changeEffect}
				className="self-start rounded-md border px-2 py-1 font-medium hover:bg-muted disabled:opacity-60"
			>
				{undone ? "Redo trust effect" : "Undo trust effect"}
			</button>
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
		</section>
	);
}

function outcomeWord(decision: ScoredDecision): string {
	return decision.outcome === "kept"
		? "kept"
		: decision.outcome === "amended"
			? "amended"
			: "changed";
}

/**
 * The trust decisions an agent message's questions made: those of message
 * `message` (its index in the thread) asking one of `subjects`.
 */
export function decisionsFor(
	{ trust }: ThreadTrust,
	message: string,
	subjects: readonly string[],
): ScoredDecision[] {
	if (trust === null) {
		return [];
	}
	return trust.decisions.filter(
		(each) =>
			each.id.split(":")[2] === message && subjects.includes(each.subject),
	);
}

/**
 * The decision overturning the conversation's `number`-th assumption, as
 * `[SPLATES OVERTURN <number>] <words>` recorded it: by its number, or by the
 * pick its words name before their `→`, as the server matches it.
 */
export function overturnDecisions(
	{ trust }: ThreadTrust,
	number: number,
	words: string,
): ScoredDecision[] {
	const unasked = (trust?.decisions ?? []).filter(
		(each) => each.source === "unasked",
	);
	const numbered = unasked.filter(
		(each) =>
			each.id.startsWith("overturn:assumed:") && each.id.endsWith(`:${number}`),
	);
	if (numbered.length > 0) {
		return numbered;
	}
	const named = words.includes("→") ? (words.split("→")[0] ?? "").trim() : "";
	return named === ""
		? []
		: unasked.filter((each) => each.subject === named).slice(-1);
}

/** The decision removing `task` to redo it, when this conversation removed it so. */
export function redoDecisions(
	{ trust }: ThreadTrust,
	task: string,
): ScoredDecision[] {
	return (trust?.decisions ?? []).filter(
		(each) => each.source === "redo" && each.task === task,
	);
}

/** Long names of decision kinds, as the Trust page shows them. */
export const KIND_NAMES: Record<DecisionKind, string> = {
	defaults: "Defaults",
	design: "API / design",
	scope: "Scope / split",
	visual: "Visual / UI",
	approval: "Approval",
};

/** Short names of decision kinds, for a line beside a pick. */
const KIND_SHORT: Record<DecisionKind, string> = {
	defaults: "Defaults",
	design: "API",
	scope: "Scope",
	visual: "Visual",
	approval: "Approval",
};

/** The order the breakdown lists kinds in, as the design does. */
const KIND_ORDER: readonly DecisionKind[] = [
	"defaults",
	"design",
	"scope",
	"visual",
	"approval",
];
