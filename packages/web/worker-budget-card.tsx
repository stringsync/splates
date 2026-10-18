import type {
	SpendShare,
	WorkerBudgetReport,
	WorkerLimit,
	WorkerStanding,
} from "@stringsync/splates-server/workers";
import { dollars } from "@stringsync/splates-server/workers/browser";
import { PencilIcon, TrendingUpIcon, XIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import {
	ends,
	RAISE_NAMES,
	WorkerLimitsForm,
	WorkerRaiseForm,
} from "./budget-forms";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";
import { PHONE_HEADING } from "./phone-rows";
import {
	endWorkerRaise,
	raiseWorkerLimit,
	setWorkerLimit,
	workerBudget,
} from "./worker-budget-api";

/** How often the page asks what made workers cost, while in front. */
const EVERY = Duration.secs(15);

/**
 * What made workers may cost, beside scry's budgets: what they burn now,
 * today, this month and by its end, a bar per limit, its raises, and who
 * the spend went to, every figure an estimate at list price.
 */
export function WorkerBudgetSection(): JSX.Element | null {
	const { report, error, change } = useWorkerBudget();
	// Without a provider no worker is made, so there is nothing to spend.
	if (report === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
					Worker budget
				</h2>
				<span className="text-muted-foreground text-xs">
					What workers a provider makes may cost, from every project.
				</span>
			</header>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{report === undefined && error === null && (
				<p role="status" className="text-muted-foreground text-sm">
					Reading the worker budget…
				</p>
			)}
			{report !== undefined && <WorkerCard report={report} change={change} />}
		</div>
	);
}

/**
 * The worker budget, asked every few seconds while the page is in front,
 * so spend moves as made workers run: undefined before the first answer,
 * null when there is no budget. `change` shows a change at once, then the
 * server's answer, or puts it back and throws the refusal.
 */
function useWorkerBudget(): {
	report: WorkerBudgetReport | null | undefined;
	error: string | null;
	change: (
		expect: (report: WorkerBudgetReport) => WorkerBudgetReport,
		send: () => Promise<WorkerBudgetReport>,
	) => Promise<void>;
} {
	const [report, setReport] = useState<WorkerBudgetReport | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
	const latest = useRef(report);
	latest.current = report;
	useEffect(() => {
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				workerBudget().then(
					(read) => {
						setReport(read);
						setError(null);
					},
					(caught: Error) => setError(caught.message),
				);
			}
		};
		ask();
		observer.events.on("change", ask);
		const tick = new SystemTimer().setInterval(ask, EVERY);
		return () => {
			tick.dispose();
			observer.dispose();
		};
	}, []);
	const change = useCallback(
		async (
			expect: (report: WorkerBudgetReport) => WorkerBudgetReport,
			send: () => Promise<WorkerBudgetReport>,
		) => {
			const before = latest.current;
			if (before != null) {
				setReport(expect(before));
			}
			try {
				setReport(await send());
			} catch (caught) {
				setReport(before);
				throw caught;
			}
		},
		[],
	);
	return { report, error, change };
}

function WorkerCard({
	report,
	change,
}: {
	report: WorkerBudgetReport;
	change: ReturnType<typeof useWorkerBudget>["change"];
}): JSX.Element {
	const now = useMinute();
	const [form, setForm] = useState<"edit" | "raise" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const act = (
		expect: (report: WorkerBudgetReport) => WorkerBudgetReport,
		send: () => Promise<WorkerBudgetReport>,
	) => {
		setForm(null);
		setError(null);
		change(expect, send).catch((caught: Error) => setError(caught.message));
	};
	const of = (limit: WorkerLimit) =>
		report.standing.find((each) => each.limit === limit);
	return (
		<section
			aria-label="workers budget"
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
				<div className="flex min-w-0 flex-col">
					<code className="font-medium font-mono text-[13px]">workers</code>
					<span className="text-muted-foreground text-xs">
						Made workers, billed by the hour while they run
					</span>
				</div>
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={form === "raise"}
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
				<dl
					aria-label="spend"
					className="grid grid-cols-4 gap-3 tabular-nums max-md:grid-cols-2"
				>
					<Figure name="Burn rate" value={`${dollars(report.rate)}/h`} />
					<Figure name="Today" value={dollars(of("day")?.spent ?? 0)} />
					<Figure
						name="Month to date"
						value={dollars(of("month")?.spent ?? 0)}
					/>
					<Figure name="Projected month" value={dollars(report.projected)} />
				</dl>
				{(report.stopped ?? report.holding) !== null && (
					<p role="status" className="text-destructive text-sm">
						{report.stopped !== null
							? `Stopped: ${report.stopped}. Made workers take nothing new until it is raised.`
							: `Queue held: ${report.holding}.`}
					</p>
				)}
				<Limits standing={report.standing} />
				{report.raises.length > 0 && (
					<ul aria-label="raises" className="flex flex-col gap-1">
						{report.raises.map((raise) => (
							<li
								key={raise.id}
								className="flex items-center gap-2 text-sm tabular-nums"
							>
								<TrendingUpIcon className="size-3.5 text-primary" />
								<span>
									+{dollars(raise.dollars)}
									{raise.limit === "hour" ? "/h" : ""} on{" "}
									{RAISE_NAMES[raise.limit]}
								</span>
								<span className="text-muted-foreground text-xs">
									ends {ends(raise.until, now)}
								</span>
								<Button
									variant="ghost"
									size="icon-xs"
									className="ml-auto text-muted-foreground"
									aria-label={`end raise ${raise.id}`}
									onClick={() =>
										act(
											(was) => unraised(was, raise.id),
											() => endWorkerRaise(raise.id),
										)
									}
								>
									<XIcon />
								</Button>
							</li>
						))}
					</ul>
				)}
				{form === "edit" && (
					<WorkerLimitsForm
						standing={report.standing}
						onSave={(changes) =>
							act(
								(was) => changes.reduce(limited, was),
								async () => {
									let last: WorkerBudgetReport = report;
									for (const [limit, amount] of changes) {
										last = await setWorkerLimit(limit, amount);
									}
									return last;
								},
							)
						}
						onCancel={() => setForm(null)}
					/>
				)}
				{form === "raise" && (
					<WorkerRaiseForm
						onRaise={(limit, amount, span) =>
							act(
								(was) => raised(was, limit, amount),
								() => raiseWorkerLimit(limit, amount, span),
							)
						}
						onCancel={() => setForm(null)}
					/>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-xs">
						{error}
					</p>
				)}
				<Split split={report.split} />
				<p className="text-muted-foreground text-xs">
					Every figure is an estimate, at each worker type's list price, not the
					provider's bill.
				</p>
			</div>
		</section>
	);
}

/** One figure of what made workers cost, marked an estimate. */
function Figure({ name, value }: { name: string; value: string }) {
	return (
		<div className="flex flex-col">
			<dt className="text-muted-foreground text-xs">{name}</dt>
			<dd className="text-sm" title="An estimate, at list price">
				{value}
				<span className="text-muted-foreground text-xs"> est.</span>
			</dd>
		</div>
	);
}

/** A bar per worker limit, toned at 80% and 90% and red once reached. */
function Limits({ standing }: { standing: WorkerStanding[] }): JSX.Element {
	return (
		<ul
			className={cn(
				"grid items-center gap-x-3 gap-y-2 max-md:gap-y-4",
				METER_COLUMNS,
			)}
		>
			{standing.map((each) => {
				const used = each.dollars === 0 ? 1 : each.spent / each.dollars;
				const tone = toneOf(used);
				const unit = each.limit === "hour" ? "/h" : "";
				return (
					<li
						key={each.limit}
						aria-label={each.window}
						className="col-span-full grid grid-cols-subgrid items-center text-sm max-md:gap-y-2 tabular-nums"
					>
						<span className="whitespace-nowrap first-letter:uppercase">
							{each.window}
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
							{dollars(each.spent)}
							{unit} of {dollars(each.dollars)}
							{unit}
							{each.raised > 0 && (
								<span className="text-muted-foreground text-xs max-md:hidden">
									{" "}
									(+{dollars(each.raised)})
								</span>
							)}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

/** Who made workers' spend went to, today or this month, by project and task. */
function Split({ split }: { split: WorkerBudgetReport["split"] }) {
	const [window, setWindow] = useState<"day" | "month">("month");
	const shares = split[window];
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="font-medium text-xs">By task</h3>
				<div role="radiogroup" aria-label="split" className="flex gap-1">
					{(["day", "month"] as const).map((each) => (
						<Button
							key={each}
							type="button"
							role="radio"
							aria-checked={window === each}
							variant={window === each ? "secondary" : "ghost"}
							size="xs"
							onClick={() => setWindow(each)}
						>
							{each === "day" ? "Today" : "This month"}
						</Button>
					))}
				</div>
			</div>
			{shares.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No made worker ran {window === "day" ? "today" : "this month"}.
				</p>
			) : (
				<ul aria-label="by task" className="flex flex-col gap-1">
					{shares.map((share) => (
						<li
							key={`${share.project} ${share.task}`}
							className="flex items-baseline gap-2 text-sm tabular-nums"
						>
							<ShareName share={share} />
							<span className="ml-auto text-muted-foreground text-xs">
								{share.project === null
									? ""
									: `${share.slotHours.toFixed(1)} slot-h`}
							</span>
							<span className="w-20 text-right">
								{dollars(share.dollars)}
								<span className="text-muted-foreground text-xs">
									{share.estimate ? " est." : ""}
								</span>
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ShareName({ share }: { share: SpendShare }): JSX.Element {
	if (share.project === null) {
		return (
			<span
				className="text-muted-foreground"
				title="Hours a made worker ran with no agent on it"
			>
				Idle
			</span>
		);
	}
	return (
		<span className="min-w-0 truncate" title={share.project}>
			<span className="text-muted-foreground">
				{share.project.split("/").at(-1)}
			</span>{" "}
			{share.task === null ? (
				<span className="text-muted-foreground italic">no task</span>
			) : (
				<code className="font-mono text-[13px]">{share.task}</code>
			)}
		</span>
	);
}

/** `report` with `limit` set to `amount`, or its default for null, before the server says. */
function limited(
	report: WorkerBudgetReport,
	[limit, amount]: [WorkerLimit, number | null],
): WorkerBudgetReport {
	if (amount === null) {
		// The default is the server's to say; the bar waits for it.
		return report;
	}
	return reshaped(report, limit, (each) => ({
		...each,
		dollars: amount + each.raised,
		set: true,
	}));
}

/** `report` with `amount` more on `limit`, before the server says. */
function raised(
	report: WorkerBudgetReport,
	limit: WorkerLimit,
	amount: number,
): WorkerBudgetReport {
	return reshaped(report, limit, (each) => ({
		...each,
		dollars: each.dollars + amount,
		raised: each.raised + amount,
	}));
}

/** `report` without raise `id`, before the server says. */
function unraised(report: WorkerBudgetReport, id: number): WorkerBudgetReport {
	const raise = report.raises.find((each) => each.id === id);
	if (raise === undefined) {
		return report;
	}
	const less = reshaped(report, raise.limit, (each) => ({
		...each,
		dollars: each.dollars - raise.dollars,
		raised: each.raised - raise.dollars,
	}));
	return { ...less, raises: less.raises.filter((each) => each.id !== id) };
}

/** `report` with `limit`'s standing changed, its left and tier counted again. */
function reshaped(
	report: WorkerBudgetReport,
	limit: WorkerLimit,
	next: (standing: WorkerStanding) => WorkerStanding,
): WorkerBudgetReport {
	return {
		...report,
		standing: report.standing.map((each) => {
			if (each.limit !== limit) {
				return each;
			}
			const changed = next(each);
			return { ...changed, left: Math.max(0, changed.dollars - changed.spent) };
		}),
	};
}
