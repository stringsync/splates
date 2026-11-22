import type { SignalOverview } from "@splates/server/signals";
import {
	ChevronRightIcon,
	CircleStopIcon,
	EllipsisIcon,
	LoaderCircleIcon,
	PencilIcon,
	PlayIcon,
	PlusIcon,
	RadioIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { pollNow, saveExpiration, stopProbe } from "./api/signals";
import { AutomationDraft } from "./automation-draft";
import { AutomationForm } from "./automation-form";
import { addAutomation } from "./automations-api";
import { ClockMeaning } from "./clock-meaning";
import { CheckDots } from "./probe-checks";
import { ArgumentTable } from "./signal-arguments";
import { Glance } from "./signal-glance";
import { ago, timeLeft } from "./signal-of";
import { historyOf, PollHistory } from "./signal-poll-history";
import { Raises } from "./signal-raises";
import { Subscribers } from "./signal-subscribers";
import { callParts, type RaiseDay, raisesPerDay } from "./signal-summary";
import { SignalTitle } from "./signal-title";

/**
 * One signal on its own page: on top, how it stands now (the last poll's
 * outcome and when it ran, or when it last fired), and below, folded until
 * asked for, its poll history, subscribers, firings, script and settings,
 * each row saying in a line what it holds.
 */
export function SignalDetail({
	signal,
	checkHref,
	onOpen,
	onChanged,
	className,
}: {
	signal: SignalOverview;
	/** The address of its check's form. */
	checkHref: string;
	/** Opens conversation `id`. */
	onOpen: (id: string) => void;
	onChanged: () => Promise<void>;
	className?: string;
}): JSX.Element {
	const now = Date.now();
	const [error, setError] = useState<string | null>(null);
	const act = (what: () => Promise<void>) => {
		setError(null);
		what()
			.then(onChanged)
			.catch((caught: unknown) => setError(String(caught)));
	};
	const [adding, setAdding] = useState<AutomationDraft | null>(null);
	const [pollingNow, setPollingNow] = useState(false);
	const pollNowAct = () => {
		// Disabled until the page shows the run, not just until it ends.
		setError(null);
		setPollingNow(true);
		pollNow(signal.name)
			.then(onChanged)
			.catch((caught: unknown) => setError(String(caught)))
			.finally(() => setPollingNow(false));
	};
	const { probe } = signal;
	const polling = probe !== null && ["idle", "running"].includes(probe.state);
	const live = signal.subscribers.filter((each) => each.live);
	const automations = signal.subscribers.filter(
		(each) => each.kind === "automation",
	).length;
	return (
		<section
			aria-label={`signal ${signal.name}`}
			className={cn("flex min-w-0 flex-col gap-5", className)}
		>
			<header className="flex items-center gap-3 sm:gap-6">
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<RadioIcon className="size-4 shrink-0 text-muted-foreground" />
					<SignalTitle name={signal.name} />
				</div>
				<div className="flex shrink-0 gap-2">
					<a
						href={checkHref}
						className={cn(
							buttonVariants({ size: "sm", variant: "outline" }),
							"h-11 sm:h-8",
						)}
					>
						{probe === null ? <PlusIcon /> : <PencilIcon />}
						<span className="max-sm:sr-only">
							{probe === null ? "Add poll script" : "Edit poll script"}
						</span>
					</a>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									size="sm"
									variant="outline"
									aria-label="More actions"
									className="size-11 sm:size-8"
								/>
							}
						>
							<EllipsisIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48">
							<DropdownMenuItem
								onClick={() => {
									const draft = new AutomationDraft();
									draft.set("when", "signal");
									draft.set("schedule", signal.name);
									setAdding(draft);
								}}
							>
								<PlusIcon /> Add automation
							</DropdownMenuItem>
							{polling && (
								<DropdownMenuItem
									onClick={() => act(() => stopProbe(signal.name))}
								>
									<CircleStopIcon /> Stop polling
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>
			<Glance signal={signal} now={now} />
			<ClockMeaning clock={signal.clock} />
			<ArgumentTable
				args={callParts(signal.name).args}
				collapsed={signal.clock !== undefined}
				className="mx-0 mb-0"
			/>
			<div className="flex flex-col gap-3">
				{probe !== null && (
					<Fold
						label="Poll history"
						summary={pollingNow ? "Polling now…" : historyOf(probe)}
						end={
							probe.runs.length > 0 && (
								<CheckDots runs={probe.runs} next={probe.state === "running"} />
							)
						}
					>
						<div className="flex flex-col gap-2">
							{polling && (
								<div className="flex items-center justify-between gap-3">
									<p className="text-muted-foreground text-xs">
										A passing poll fires the signal.
									</p>
									<Button
										size="sm"
										variant="outline"
										disabled={pollingNow}
										onClick={pollNowAct}
										className="h-11 shrink-0 sm:h-8"
									>
										{pollingNow ? (
											<LoaderCircleIcon aria-hidden className="animate-spin" />
										) : (
											<PlayIcon />
										)}
										{pollingNow ? "Polling…" : "Poll now"}
									</Button>
								</div>
							)}
							<PollHistory probe={probe} now={now} />
						</div>
					</Fold>
				)}
				<Fold
					label="Subscribers"
					summary={
						live.length === 0
							? "Nothing waits on or runs from it"
							: live.map((each) => each.title ?? each.label).join(" · ")
					}
				>
					<Subscribers
						subscribers={signal.subscribers}
						now={now}
						onOpen={onOpen}
						act={act}
					/>
				</Fold>
				<Fold
					label="Firings"
					summary={
						signal.raises[0] === undefined
							? "None in the last 7 days"
							: `${signal.raises.length} in 7 days · last ${ago(signal.raises[0].at, now)}`
					}
				>
					<div className="flex flex-col gap-4">
						<DayChart days={raisesPerDay(signal.raises, now)} />
						<Raises raises={signal.raises} now={now} />
					</div>
				</Fold>
				{probe !== null && (
					<Fold label="Script" summary={probe.script.split("\n")[0] ?? ""} mono>
						<div className="flex flex-col gap-2 text-sm">
							<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
								{probe.script}
							</pre>
						</div>
					</Fold>
				)}
				<Fold
					label="Settings"
					summary={[
						polling && probe !== null
							? `polling stops in ${timeLeft(probe.deadline, now)}`
							: null,
						signal.expiresAt === undefined
							? "no expiration"
							: `expires ${new Date(signal.expiresAt).toLocaleString()}`,
						`${automations} ${automations === 1 ? "automation" : "automations"}`,
					]
						.filter((each) => each !== null)
						.join(" · ")
						.replace(/^./, (first) => first.toUpperCase())}
				>
					<Expiration
						key={`${signal.name}:${signal.expiresAt ?? ""}`}
						signal={signal}
						act={act}
					/>
				</Fold>
			</div>
			<Dialog
				open={adding !== null}
				onOpenChange={(open) => !open && setAdding(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add an automation</DialogTitle>
						<DialogDescription>
							Runs each time {signal.name} is fired.
						</DialogDescription>
					</DialogHeader>
					{adding !== null && (
						<AutomationForm
							draft={adding}
							signal={signal.name}
							title="Add an automation"
							submit="Add"
							onCancel={() => setAdding(null)}
							onSubmit={(trigger, hook, name) =>
								act(async () => {
									await addAutomation(trigger, hook, name);
									setAdding(null);
								})
							}
						/>
					)}
				</DialogContent>
			</Dialog>
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
		</section>
	);
}

/** One folded section: its label and one-line summary, opening to what it holds. */
function Fold({
	label,
	summary,
	end,
	mono = false,
	children,
}: {
	label: string;
	summary: string;
	/** What shows at the row's end, such as the poll dots. */
	end?: ReactNode;
	/** Whether the summary is code. */
	mono?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<Collapsible className="rounded-xl border bg-card shadow-xs">
			<CollapsibleTrigger
				aria-label={label}
				className="group flex min-h-12 w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted/30"
			>
				<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
				<span className="shrink-0 font-semibold">{label}</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-muted-foreground",
						mono ? "font-mono text-xs" : "text-[13px]",
					)}
				>
					{summary}
				</span>
				{end !== undefined && end !== false && (
					<span className="shrink-0 max-sm:hidden">{end}</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent className="border-t px-4 pt-3 pb-4 sm:pl-10">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** Firings per day, today picked out; each bar says its day and count on hover. */
function DayChart({ days }: { days: RaiseDay[] }): JSX.Element {
	const most = Math.max(1, ...days.map((day) => day.count));
	return (
		<figure className="flex flex-col gap-2">
			<figcaption className="flex items-baseline gap-2 font-semibold text-sm">
				Firings per day
				<span className="font-normal text-muted-foreground text-xs">
					last 7 days
				</span>
			</figcaption>
			<div className="relative ml-7 h-28">
				<span className="absolute top-0 -left-7 w-5 -translate-y-1/2 text-right text-[11px] text-muted-foreground tabular-nums">
					{most}
				</span>
				<span className="absolute bottom-0 -left-7 w-5 translate-y-1/2 text-right text-[11px] text-muted-foreground">
					0
				</span>
				<div className="absolute inset-x-0 top-0 border-t" />
				<div className="absolute inset-x-0 top-1/2 border-t" />
				<div className="absolute inset-0 flex items-end gap-0.5 border-input border-b">
					{days.map((day) => {
						const today = day.label === "Today";
						const says = `${day.label}: ${day.count} ${day.count === 1 ? "firing" : "firings"}`;
						return (
							<div
								key={day.label}
								role="img"
								aria-label={says}
								className={cn(
									"group relative flex h-full flex-1 items-end justify-center rounded-md hover:bg-muted/50",
									today && "bg-muted/40",
								)}
							>
								<div
									className={cn(
										"w-[44%] rounded-t",
										today ? "bg-foreground" : "bg-muted-foreground",
									)}
									style={{ height: `${(day.count / most) * 100}%` }}
								/>
								<span className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md group-hover:block">
									<span className="font-semibold">{day.label}</span>
									<span className="text-muted-foreground">
										{" "}
										· {day.count} {day.count === 1 ? "firing" : "firings"}
									</span>
								</span>
							</div>
						);
					})}
				</div>
			</div>
			<div className="ml-7 flex gap-0.5">
				{days.map((day) => (
					<span
						key={day.label}
						className="flex-1 text-center text-muted-foreground text-xs"
					>
						{day.label}
					</span>
				))}
			</div>
		</figure>
	);
}

/** Optional removal deadline, entered as a duration or calendar date. */
function Expiration({
	signal,
	act,
}: {
	signal: SignalOverview;
	act: (what: () => Promise<void>) => void;
}) {
	const [expires, setExpires] = useState(signal.expiresAt ?? "");
	const [saving, setSaving] = useState(false);
	const save = (value: string | null) =>
		act(async () => {
			setSaving(true);
			try {
				await saveExpiration(signal.name, value);
			} finally {
				setSaving(false);
			}
		});
	return (
		<form
			className="flex flex-wrap gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				save(expires);
			}}
		>
			<Field className="min-w-0 basis-full">
				<FieldLabel htmlFor="signal-expiration">
					Expiration (optional)
				</FieldLabel>
				<Input
					id="signal-expiration"
					value={expires}
					onChange={(event) => setExpires(event.target.value)}
					placeholder="2h, 7d, or 2026-12-01T17:00:00-05:00"
					required
					disabled={saving}
				/>
				<FieldDescription>
					{signal.expiresAt === undefined
						? "No expiration."
						: `Removes automatically at ${new Date(signal.expiresAt).toLocaleString()}.`}{" "}
					Dates without a time use midnight UTC.
				</FieldDescription>
			</Field>
			<Button
				type="submit"
				size="sm"
				variant="outline"
				disabled={saving || expires.trim() === ""}
			>
				Save expiration
			</Button>
			{signal.expiresAt !== undefined && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={saving}
					onClick={() => save(null)}
				>
					Clear expiration
				</Button>
			)}
		</form>
	);
}
