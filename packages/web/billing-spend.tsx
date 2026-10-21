import type {
	BillingView,
	SpendReport,
	SpendTotal,
} from "@stringsync/splates-server/spend";
import { ChevronRightIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { billing, pullBilling, setCurrency, spend } from "./api";
import { credAddress } from "./page-address";
import { PHONE_HEADING } from "./phone-rows";

const Currency = createContext("USD");

const useMoney = (): ((amount: number) => string) => {
	const currency = useContext(Currency);
	return (amount) => money(amount, currency);
};

type Range = "day" | "week" | "month" | "custom";

const RANGES: Range[] = ["day", "week", "month", "custom"];

const DAY = 86_400_000;

const money = (amount: number, currency: string): string =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
		maximumFractionDigits: 2,
	}).format(amount);

/** The UTC day `at` falls in, as `2026-10-21`, as the ledger's days are. */
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The span `range` covers ending at `now`, as ISO timestamps, `until` exclusive. */
export function spanOf(
	range: Exclude<Range, "custom">,
	now: number,
): { since: string; until: string } {
	const today = Date.parse(dayOf(now));
	const first =
		range === "day"
			? today
			: range === "week"
				? today - 6 * DAY
				: Date.parse(`${dayOf(now).slice(0, 7)}-01`);
	return {
		since: new Date(first).toISOString(),
		until: new Date(today + DAY).toISOString(),
	};
}

/** What one provider's dollars add up to, the two kinds apart. */
function sum(rows: SpendTotal[]): { billed: number; equivalent: number } {
	return {
		billed: rows.reduce((all, row) => all + row.billed, 0),
		equivalent: rows.reduce((all, row) => all + row.equivalent, 0),
	};
}

/**
 * The dollars spent in a range, from the ledger: the total, each provider
 * with the services under it, and each provider's days. Billed amounts are
 * money paid; an estimate is what a plan's use would cost at API list prices.
 */
export function SpendSection(): JSX.Element {
	const [range, setRange] = useState<Range>("month");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	// Held while it reads again, so a change of range never blanks the figures.
	const [report, setReport] = useState<SpendReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sources, setSources] = useState<BillingView | null>(null);
	const [pulling, setPulling] = useState(false);
	const [sourceError, setSourceError] = useState<string | null>(null);
	const currency = sources?.currency ?? null;
	const span = useMemo(() => {
		if (range !== "custom") {
			return spanOf(range, Date.now());
		}
		const since = Date.parse(from);
		const until = Date.parse(to);
		return Number.isNaN(since) || Number.isNaN(until) || until < since
			? null
			: {
					since: new Date(since).toISOString(),
					until: new Date(until + DAY).toISOString(),
				};
	}, [range, from, to]);
	// Read what was last pulled at once, then pull again, so the figures catch up.
	useEffect(() => {
		let current = true;
		billing()
			.then((read) => current && setSources(read))
			.catch((caught: Error) => current && setSourceError(caught.message));
		setPulling(true);
		pullBilling()
			.then((read) => current && setSources(read))
			.catch((caught: Error) => current && setSourceError(caught.message))
			.finally(() => current && setPulling(false));
		return () => {
			current = false;
		};
	}, []);
	const pulledAt = sources?.pulledAt ?? null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new currency or pull is when to read again
	useEffect(() => {
		if (span === null) {
			return;
		}
		let current = true;
		spend(span.since, span.until).then(
			(read) => {
				if (current) {
					setReport(read);
					setError(null);
				}
			},
			(caught: Error) => current && setError(caught.message),
		);
		return () => {
			current = false;
		};
	}, [span, currency, pulledAt]);
	const providers = useMemo(() => {
		const byProvider = new Map<string, SpendTotal[]>();
		for (const row of report?.services ?? []) {
			byProvider.set(row.provider ?? "", [
				...(byProvider.get(row.provider ?? "") ?? []),
				row,
			]);
		}
		return [...byProvider]
			.map(([provider, services]) => ({
				provider,
				services,
				...sum(services),
			}))
			.sort(
				(one, other) =>
					other.billed + other.equivalent - (one.billed + one.equivalent),
			);
	}, [report]);
	const total = sum(report?.services ?? []);
	return (
		<Currency.Provider value={report?.currency ?? "USD"}>
			<section aria-label="spend" className="flex min-w-0 flex-col gap-4">
				<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
					<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>Spend</h2>
					<span className="text-muted-foreground text-xs">
						Spend across every project on this machine, by UTC day.
					</span>
					{sources !== null && (
						<select
							aria-label="currency"
							value={sources.currency}
							onChange={(event) =>
								setCurrency(event.target.value).then(
									setSources,
									(caught: Error) => setSourceError(caught.message),
								)
							}
							className="ml-auto rounded-md border bg-transparent px-2 py-1 text-xs"
						>
							{sources.currencies.map((each) => (
								<option key={each} value={each}>
									{each}
								</option>
							))}
						</select>
					)}
				</header>
				<fieldset
					aria-label="range"
					className="flex flex-wrap items-center gap-1"
				>
					{RANGES.map((each) => (
						<button
							key={each}
							type="button"
							aria-pressed={range === each}
							onClick={() => setRange(each)}
							className={cn(
								"rounded-md border px-2.5 py-1 text-xs capitalize",
								range === each
									? "bg-accent font-medium"
									: "text-muted-foreground",
							)}
						>
							{each === "day" ? "Today" : each === "week" ? "7 days" : each}
						</button>
					))}
					{range === "custom" && (
						<span className="flex items-center gap-1 text-xs">
							<input
								type="date"
								aria-label="from"
								value={from}
								onChange={(event) => setFrom(event.target.value)}
								className="rounded-md border bg-transparent px-2 py-1"
							/>
							to
							<input
								type="date"
								aria-label="to"
								value={to}
								onChange={(event) => setTo(event.target.value)}
								className="rounded-md border bg-transparent px-2 py-1"
							/>
						</span>
					)}
				</fieldset>
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						Could not read spend: {error}
					</p>
				)}
				{report === null && error === null && span !== null && (
					<p role="status" className="text-muted-foreground text-sm">
						Reading spend…
					</p>
				)}
				{span === null && (
					<p className="text-muted-foreground text-sm">
						Pick the first and last day to total.
					</p>
				)}
				{report !== null && (
					<>
						<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
							<Figure label="Billed" amount={total.billed} />
							<Figure
								label="Estimate"
								amount={total.equivalent}
								hint="Plan use priced at API list prices, not money paid"
							/>
						</div>
						{providers.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								Nothing spent in this range.
							</p>
						) : (
							<ul className="flex flex-col gap-2">
								{providers.map((each) => (
									<ProviderRow key={each.provider} {...each} />
								))}
							</ul>
						)}
						{providers.length > 0 && <Trend days={report.days} />}
						<p className="text-muted-foreground text-xs">
							Updated {new Date(report.updated).toLocaleTimeString()}
							{report.rateDate !== null &&
								`. Converted to ${report.currency} at the rate of each day, the latest from ${report.rateDate}.`}
						</p>
						{report.rateError !== null && (
							<p role="alert" className="text-destructive text-xs">
								Shown in USD: {report.rateError}
							</p>
						)}
					</>
				)}
				<Sources sources={sources} pulling={pulling} error={sourceError} />
			</section>
		</Currency.Provider>
	);
}

/** Where billed amounts come from: each provider, its last pull, and the cred it needs. */
function Sources({
	sources,
	pulling,
	error,
}: {
	sources: BillingView | null;
	pulling: boolean;
	error: string | null;
}): JSX.Element {
	return (
		<section aria-label="billing sources" className="flex flex-col gap-2">
			<h3 className="font-medium text-sm">
				Billing sources
				{pulling && (
					<span role="status" className="ml-2 text-muted-foreground text-xs">
						Pulling…
					</span>
				)}
			</h3>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					Could not read billing sources: {error}
				</p>
			)}
			<ul className="flex flex-col gap-1">
				{(sources?.providers ?? []).map((each) => (
					<li
						key={each.provider}
						className="flex flex-wrap items-baseline gap-x-2 text-sm"
					>
						<span className="font-medium">{each.provider}</span>
						{each.state === "ok" && (
							<span className="text-muted-foreground text-xs">pulled</span>
						)}
						{each.state === "manual" && (
							<span className="text-muted-foreground text-xs">
								{each.message}
							</span>
						)}
						{each.state === "unreachable" && (
							<span role="alert" className="text-destructive text-xs">
								{each.message}
							</span>
						)}
						{each.state === "missing" && each.cred !== null && (
							<a
								href={credAddress(each.cred)}
								className="text-xs underline underline-offset-2"
							>
								Add {each.cred} on the Creds page
							</a>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

function Figure({
	label,
	amount,
	hint,
}: {
	label: string;
	amount: number;
	hint?: string;
}): JSX.Element {
	const dollars = useMoney();
	return (
		<span title={hint} className="flex flex-col">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-medium text-2xl tabular-nums">
				{dollars(amount)}
			</span>
		</span>
	);
}

/** One provider's dollars, opening onto the services under it. */
function ProviderRow({
	provider,
	services,
	billed,
	equivalent,
}: {
	provider: string;
	services: SpendTotal[];
	billed: number;
	equivalent: number;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<li className="rounded-xl border bg-card shadow-xs">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn("size-4 transition-transform", open && "rotate-90")}
				/>
				<span className="font-medium text-sm">{provider}</span>
				<Amounts billed={billed} equivalent={equivalent} />
			</button>
			{open && (
				<ul className="flex flex-col gap-1 border-t px-4 py-2">
					{services.map((row) => (
						<li key={row.service} className="flex items-baseline gap-2 text-sm">
							<code className="font-mono text-[13px]">{row.service}</code>
							<Amounts billed={row.billed} equivalent={row.equivalent} />
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/** Each kind that is nonzero, marked as billed or an estimate. */
function Amounts({
	billed,
	equivalent,
}: {
	billed: number;
	equivalent: number;
}): JSX.Element {
	const dollars = useMoney();
	return (
		<span className="ml-auto flex items-baseline gap-3 tabular-nums">
			{billed > 0 && (
				<span>
					{dollars(billed)}{" "}
					<span className="text-muted-foreground text-xs">billed</span>
				</span>
			)}
			{equivalent > 0 && (
				<span className="text-muted-foreground">
					{dollars(equivalent)} <span className="text-xs">estimate</span>
				</span>
			)}
		</span>
	);
}

/** Each day's dollars as a bar, stacked by provider. */
function Trend({ days }: { days: SpendTotal[] }): JSX.Element {
	const dollars = useMoney();
	const dates = [...new Set(days.map((row) => row.period ?? ""))];
	const providers = [...new Set(days.map((row) => row.provider ?? ""))];
	const cost = (row: SpendTotal) => row.billed + row.equivalent;
	const tallest = Math.max(
		...dates.map((date) =>
			days
				.filter((row) => row.period === date)
				.reduce((all, row) => all + cost(row), 0),
		),
	);
	return (
		<figure aria-label="Spend per day" className="flex flex-col gap-2">
			<div className="flex h-24 items-end gap-0.5">
				{dates.map((date) => (
					<div
						key={date}
						title={`${date}: ${dollars(
							days
								.filter((row) => row.period === date)
								.reduce((all, row) => all + cost(row), 0),
						)}`}
						className="flex min-w-0 flex-1 flex-col-reverse"
					>
						{providers.map((provider, index) => {
							const row = days.find(
								(each) => each.period === date && each.provider === provider,
							);
							return row === undefined ? null : (
								<div
									key={provider}
									style={{
										height: `${(cost(row) / tallest) * 96}px`,
										background: `var(--chart-${(index % 5) + 1})`,
									}}
								/>
							);
						})}
					</div>
				))}
			</div>
			<figcaption className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
				{providers.map((provider, index) => (
					<span key={provider} className="flex items-center gap-1">
						<span
							aria-hidden
							className="size-2 rounded-sm"
							style={{ background: `var(--chart-${(index % 5) + 1})` }}
						/>
						{provider}
					</span>
				))}
			</figcaption>
		</figure>
	);
}
