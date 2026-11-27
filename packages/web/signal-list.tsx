import type { SignalOverview } from "@splates/server/signals";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { ArgumentChips } from "./signal-arguments";
import { ago } from "./signal-of";
import { isLive, type SignalTone, statusOf } from "./signal-status";
import {
	callParts,
	liveCount,
	namespaceOf,
	namespacesOf,
	raisesPerDay,
} from "./signal-summary";

/** The index's columns, shared by its header and rows; a phone keeps the dot, the name and the chevron. */
const COLUMNS =
	"grid grid-cols-[0.5rem_minmax(0,1fr)_1rem] items-center gap-x-3.5 md:grid-cols-[0.5rem_minmax(0,1.3fr)_minmax(0,1.4fr)_5.5rem_4.5rem_6.5rem_1rem]";

/** One line of a project's card: a signal, or a family of them sharing a namespace, folded. */
type Item =
	| { kind: "signal"; signal: SignalOverview }
	| { kind: "family"; namespace: string; signals: SignalOverview[] };

/**
 * The Signals index: pass every signal and the address of each signal's
 * page. It shows a card per project, a row per signal saying how it stands,
 * with a filter by name and `actions` beside it.
 */
export function SignalIndex({
	signals,
	address,
	actions,
	now = Date.now(),
}: {
	signals: SignalOverview[];
	/** The address of signal `name`'s page. */
	address: (name: string) => string;
	/** What sits at the end of the filter's row, such as New poll script. */
	actions?: ReactNode;
	now?: number;
}): JSX.Element {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
	const toggle = (key: string) =>
		setOpen((was) => {
			const next = new Set(was);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	const wanted = query.trim().toLowerCase();
	const shown = signals.filter((each) =>
		each.name.toLowerCase().includes(wanted),
	);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3 sm:flex-wrap">
				<div className="relative min-w-0 max-w-sm flex-1 max-sm:max-w-none sm:basis-56">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="Filter signals"
						placeholder="Filter signals"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						className="h-11 pl-9 sm:h-9"
					/>
				</div>
				<span className="flex-1 max-sm:hidden" />
				{actions}
			</div>
			{shown.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No signal matches “{query}”.
				</p>
			)}
			{projectsOf(shown).map(([project, members]) => (
				<ProjectCard
					key={project}
					project={project}
					signals={members}
					open={open}
					opened={wanted !== ""}
					toggle={toggle}
					address={address}
					now={now}
				/>
			))}
		</div>
	);
}

function ProjectCard({
	project,
	signals,
	open,
	opened,
	toggle,
	address,
	now,
}: {
	project: string;
	signals: SignalOverview[];
	open: ReadonlySet<string>;
	/** Whether every family shows its signals, as while filtering. */
	opened: boolean;
	toggle: (key: string) => void;
	address: (name: string) => string;
	now: number;
}): JSX.Element {
	const polling = signals.filter(
		(each) => each.probe?.state === "running" || each.probe?.state === "idle",
	).length;
	return (
		<section
			aria-label={`project ${project}`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex items-baseline gap-2.5 border-b px-4 py-3">
				<h2 className="font-mono font-semibold text-sm">{project}</h2>
				<span className="text-muted-foreground text-xs">
					{signals.length} {signals.length === 1 ? "signal" : "signals"}
					{polling > 0 && ` · ${polling} polling`}
				</span>
			</header>
			<div
				aria-hidden
				className={cn(
					COLUMNS,
					"border-b px-4 pt-2 pb-1.5 text-[11px] text-muted-foreground uppercase tracking-wide max-md:hidden",
				)}
			>
				<span />
				<span>Signal</span>
				<span>Now</span>
				<span>Last fired</span>
				<span>7 days</span>
				<span>Subscribers</span>
				<span />
			</div>
			<ul className="divide-y">
				{itemsOf(project, signals).map((item) =>
					item.kind === "signal" ? (
						<li key={item.signal.name}>
							<SignalRow
								signal={item.signal}
								href={address(item.signal.name)}
								now={now}
							/>
						</li>
					) : (
						<Family
							key={item.namespace}
							item={item}
							open={opened || open.has(item.namespace)}
							onToggle={() => toggle(item.namespace)}
							address={address}
							now={now}
						/>
					),
				)}
			</ul>
		</section>
	);
}

function SignalRow({
	signal,
	href,
	now,
	nested = false,
}: {
	signal: SignalOverview;
	href: string;
	now: number;
	/** Whether it shows inside an opened family, indented. */
	nested?: boolean;
}): JSX.Element {
	const status = statusOf(signal, now);
	const { namespace, leaf } = namespaceOf(signal.name);
	const live = liveCount(signal);
	return (
		<a
			href={href}
			aria-label={`signal ${signal.name}`}
			className={cn(
				COLUMNS,
				"min-h-11 px-4 py-2.5 text-[13.5px] hover:bg-muted/40",
				nested && "md:pl-10",
			)}
		>
			<StatusDot tone={status.tone} />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="flex min-w-0 flex-wrap items-center gap-1">
					<span className="truncate font-mono text-[13px]">
						{namespace !== leaf && (
							<span className="text-muted-foreground">{namespace}.</span>
						)}
						{leaf}
					</span>
					<ArgumentChips args={callParts(signal.name).args} />
				</span>
				<span className="truncate text-muted-foreground text-xs md:hidden">
					{status.short}
				</span>
			</span>
			<span
				className={cn(
					"truncate max-md:hidden",
					status.tone === "quiet" || status.tone === "stopped"
						? "text-muted-foreground"
						: status.tone === "broken" && "text-destructive",
				)}
			>
				{status.short}
			</span>
			<span className="text-muted-foreground text-xs max-md:hidden">
				{signal.raises[0] === undefined
					? "never"
					: ago(signal.raises[0].at, now)}
			</span>
			<Spark
				counts={raisesPerDay(signal.raises, now).map((day) => day.count)}
			/>
			<span
				className={cn(
					"truncate text-xs max-md:hidden",
					live === 0 ? "text-muted-foreground" : "font-medium",
				)}
			>
				{subscribersOf(signal)}
			</span>
			<ChevronRightIcon className="size-3.5 text-muted-foreground" />
		</a>
	);
}

/** A folded family: one row for its signals, opening to list them. */
function Family({
	item,
	open,
	onToggle,
	address,
	now,
}: {
	item: Extract<Item, { kind: "family" }>;
	open: boolean;
	onToggle: () => void;
	address: (name: string) => string;
	now: number;
}): JSX.Element {
	const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
	const latest = item.signals
		.map((each) => each.raises[0]?.at ?? "")
		.sort()
		.at(-1);
	const days = item.signals
		.map((each) => raisesPerDay(each.raises, now).map((day) => day.count))
		.reduce((sum, counts) => sum.map((count, at) => count + (counts[at] ?? 0)));
	const by = [
		...new Set(
			item.signals.flatMap((each) => each.raises.map((raise) => raise.by)),
		),
	];
	return (
		<li>
			<button
				type="button"
				aria-expanded={open}
				aria-label={`${item.namespace}, ${item.signals.length} signals`}
				onClick={onToggle}
				className={cn(
					COLUMNS,
					"min-h-11 w-full bg-muted/30 px-4 py-2.5 text-left text-[13.5px] hover:bg-muted/50",
				)}
			>
				<Chevron className="-ml-1 size-3.5 text-muted-foreground" />
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate font-mono font-semibold text-[13px]">
						{item.namespace}.<span className="text-muted-foreground">*</span>
					</span>
					<span className="truncate text-muted-foreground text-xs md:hidden">
						{item.signals.length} signals
					</span>
				</span>
				<span className="truncate text-muted-foreground max-md:hidden">
					{item.signals.length} signals
					{by.length === 1 && `, fired by ${by[0]}`}
				</span>
				<span className="text-muted-foreground text-xs max-md:hidden">
					{latest === undefined || latest === "" ? "never" : ago(latest, now)}
				</span>
				<Spark counts={days} />
				<span className="truncate text-muted-foreground text-xs max-md:hidden">
					{subscribersOf(...item.signals)}
				</span>
				<span />
			</button>
			{open && (
				<ul className="divide-y border-t">
					{item.signals.map((signal) => (
						<li key={signal.name}>
							<SignalRow
								signal={signal}
								href={address(signal.name)}
								now={now}
								nested
							/>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/** Firings per day over the week as small bars, today darkest. */
function Spark({ counts }: { counts: number[] }): JSX.Element {
	const most = Math.max(1, ...counts);
	const total = counts.reduce((sum, count) => sum + count, 0);
	return (
		<span
			role="img"
			aria-label={`${total} ${total === 1 ? "firing" : "firings"} in 7 days`}
			className="flex h-4.5 items-end gap-0.5 max-md:hidden"
		>
			{counts.map((count, at) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: the days are fixed, oldest first
					key={at}
					className={cn(
						"w-1.5 rounded-[2px]",
						count === 0
							? "h-0.5 bg-muted-foreground/30"
							: at === counts.length - 1
								? "bg-foreground"
								: "bg-muted-foreground/70",
					)}
					style={
						count === 0
							? undefined
							: { height: `${Math.max(12, (count / most) * 100)}%` }
					}
				/>
			))}
		</span>
	);
}

/** A tone's dot: a pulsing ring while polling, green for passed, red for broken, a ring once stopped. */
export function StatusDot({
	tone,
	className,
}: {
	tone: SignalTone;
	className?: string;
}): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"size-2 shrink-0 rounded-full",
				tone === "polling" && "bg-info ring-[3px] ring-info/25",
				tone === "passed" && "bg-success",
				tone === "broken" && "bg-destructive ring-[3px] ring-destructive/20",
				tone === "quiet" && "bg-muted-foreground/45",
				(tone === "stopped" || tone === "removed") &&
					"border-[1.5px] border-muted-foreground/60",
				className,
			)}
		/>
	);
}

/** "2 waiting", "1 automation", "2 waiting · 1 automation", or "none". */
function subscribersOf(...signals: SignalOverview[]): string {
	const live = signals.flatMap((each) =>
		each.subscribers.filter((sub) => sub.live),
	);
	const waits = live.filter((sub) => sub.kind === "wait").length;
	const tasks = live.filter((sub) => sub.kind === "task").length;
	const automations = live.length - waits - tasks;
	const parts = [
		waits > 0 ? `${waits} waiting` : null,
		tasks > 0 ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : null,
		automations > 0
			? `${automations} ${automations === 1 ? "automation" : "automations"}`
			: null,
	].filter((each) => each !== null);
	return parts.length === 0 ? "none" : parts.join(" · ");
}

/** `signals` by project, a project with anything live first, then the one fired most lately. */
function projectsOf(
	signals: SignalOverview[],
): [project: string, signals: SignalOverview[]][] {
	const byProject = new Map<string, SignalOverview[]>();
	for (const each of signals) {
		byProject.set(each.project, [...(byProject.get(each.project) ?? []), each]);
	}
	const latest = (members: SignalOverview[]) =>
		members
			.map((each) => each.raises[0]?.at ?? "")
			.sort()
			.at(-1) ?? "";
	return [...byProject].sort(
		([one, first], [other, second]) =>
			Number(second.some(isLive)) - Number(first.some(isLive)) ||
			latest(second).localeCompare(latest(first)) ||
			one.localeCompare(other),
	);
}

/** A project's lines: a family for each namespace below the project's with more than one signal, the live first. */
function itemsOf(project: string, signals: SignalOverview[]): Item[] {
	const items = namespacesOf(signals).flatMap((group): Item[] =>
		group.namespace !== project && group.signals.length > 1
			? [{ kind: "family", namespace: group.namespace, signals: group.signals }]
			: group.signals.map((signal) => ({ kind: "signal", signal })),
	);
	const live = (item: Item) =>
		item.kind === "signal" ? isLive(item.signal) : item.signals.some(isLive);
	return items.sort((one, other) => Number(live(other)) - Number(live(one)));
}
