import type { SignalOverview } from "@splates/server/signals";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { timeLeft } from "./signal-of";
import { familiesOf, familyOf } from "./signal-summary";

/**
 * The list beside a signal's detail: pass every signal, the one shown and
 * how to address each, and it links each signal by name and its count of
 * raises this week, armed ones first, under family headings that fold.
 */
export function SignalList({
	signals,
	selected,
	picked,
	address,
	className,
}: {
	signals: SignalOverview[];
	/** The signal whose detail shows, or null. */
	selected: string | null;
	/** Whether the address picked it, rather than the page for want of one; a phone, which then shows only the list, marks it only when picked. */
	picked: boolean;
	/** The address that selects signal `name`. */
	address: (name: string) => string;
	className?: string;
}): JSX.Element {
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	const fold = (key: string) =>
		setFolded((now) => {
			const next = new Set(now);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	const sections = [
		{ title: "Armed", members: signals.filter((each) => each.armed) },
		{ title: "Recent", members: signals.filter((each) => !each.armed) },
	].filter((section) => section.members.length > 0);
	return (
		<nav
			aria-label="signal list"
			className={cn(
				"flex flex-col gap-1 rounded-xl border bg-card p-1.5 shadow-xs",
				className,
			)}
		>
			{sections.map((section) => (
				<div key={section.title} className="flex flex-col">
					<h2 className="px-2.5 pt-2.5 pb-1 text-[11px] text-muted-foreground uppercase tracking-wide">
						{section.title} · {section.members.length}
					</h2>
					{familiesOf(section.members).map((family) => {
						const key = `${section.title}:${family.family}`;
						const open = !folded.has(key);
						const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
						return (
							<div key={key} className="flex flex-col">
								<button
									type="button"
									aria-expanded={open}
									onClick={() => fold(key)}
									className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/50"
								>
									<Chevron className="size-3.5 text-muted-foreground" />
									<span className="truncate font-mono">{family.family}</span>
									<span className="ml-auto text-muted-foreground text-xs tabular-nums">
										{section.title === "Armed"
											? family.signals.length
											: family.raises}
									</span>
								</button>
								{open &&
									family.signals.map((signal) => (
										<Row
											key={signal.name}
											signal={signal}
											href={address(signal.name)}
											selected={signal.name === selected}
											picked={picked}
										/>
									))}
							</div>
						);
					})}
				</div>
			))}
		</nav>
	);
}

function Row({
	signal,
	href,
	selected,
	picked,
}: {
	signal: SignalOverview;
	href: string;
	selected: boolean;
	picked: boolean;
}): JSX.Element {
	const left = soonestDeadline(signal);
	return (
		<a
			href={href}
			aria-current={selected ? "true" : undefined}
			aria-label={`signal ${signal.name}`}
			className={cn(
				"flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-7 text-[13px] hover:bg-muted/50",
				selected &&
					(picked
						? "bg-accent hover:bg-accent"
						: "md:bg-accent md:hover:bg-accent"),
			)}
		>
			<span className="truncate font-mono">{familyOf(signal.name).leaf}</span>
			{signal.armed ? (
				<span className="ml-auto flex items-center gap-1 rounded-full bg-warning/20 px-2 text-warning text-xs">
					<span className="size-1.5 rounded-full bg-current" />
					{left === null ? "armed" : `${timeLeft(left, Date.now())} left`}
				</span>
			) : (
				<span
					className="ml-auto text-muted-foreground text-xs tabular-nums"
					title="raises in the last 7 days"
				>
					{signal.raises.length}
				</span>
			)}
		</a>
	);
}

/** When the soonest armed wait on it gives up, or null for none with a deadline. */
function soonestDeadline(signal: SignalOverview): string | null {
	const deadlines = signal.subscribers
		.filter((each) => each.armed && each.deadline !== undefined)
		.map((each) => each.deadline ?? "")
		.sort();
	return deadlines[0] ?? null;
}
