import type {
	DecisionOutcome,
	DecisionSource,
	TrustActionBand,
} from "@splates/server/trust";
import {
	ASSUME_AFTER,
	BAND_FLOORS,
	DECAY_HALF_LIFE,
	DECISION_WEIGHTS,
	KEPT_TO_ASSUME_AGAIN,
	KIND_LABELS,
	NEUTRAL_TRUST,
	PRIOR_ALPHA,
	PRIOR_BETA,
	TRUST_ACTIONS,
	TRUST_BANDS,
} from "@splates/server/trust/browser";
import {
	LockIcon,
	ShieldIcon,
	ShieldMinusIcon,
	ShieldPlusIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * The Trust page's How it works tab: what changes trust and by how much, what
 * each band allows (and which of that the server enforces), how the score
 * adds up and what the user controls. Weights, thresholds and actions come
 * from the table the server's gates read, so the key never drifts from them.
 */
export function TrustHowItWorks(): JSX.Element {
	return (
		<div className="flex flex-col gap-5">
			<WeightsCard />
			<BandsCard />
			<MathCard />
			<ControlsCard />
		</div>
	);
}

/** One way a decision can go, and what it weighs, or 0 for one never recorded. */
interface WeightRow {
	title: string;
	detail?: string;
	/** The table entry it weighs, or none for something that is never recorded. */
	from?: [DecisionSource, DecisionOutcome];
}

const WEIGHT_ROWS: readonly WeightRow[] = [
	{
		title: "A question’s pick is taken as offered",
		detail: "You answer with the agent’s chosen choice and nothing more.",
		from: ["question", "kept"],
	},
	{
		title: "A mockup’s pick is taken",
		detail: "The same, for a question with images.",
		from: ["mockup", "kept"],
	},
	{
		title: "A plan is approved as written",
		detail: "Approve, with every pick in it kept.",
		from: ["plan", "kept"],
	},
	{
		title: "A question is answered another way",
		detail: "Another choice, or words instead of the pick.",
		from: ["question", "overturned"],
	},
	{
		title: "A mockup is answered another way",
		from: ["mockup", "overturned"],
	},
	{
		title: "A plan is sent back",
		detail: "No, or a reply that sends it back.",
		from: ["plan", "overturned"],
	},
	{
		title: "An assumption is overturned or marked wrong",
		detail: `That kind of call asks first again until ${KEPT_TO_ASSUME_AGAIN} of its picks are kept.`,
		from: ["unasked", "overturned"],
	},
	{ title: "A task is removed to be redone", from: ["redo", "overturned"] },
	{
		title: "A merged task is reverted on main",
		from: ["revert", "overturned"],
	},
	{
		title: "A pick or plan is taken with changes",
		detail: "You take it but add words.",
		from: ["question", "amended"],
	},
	{
		title: "An assumption you leave standing",
		detail: "A call made without asking never raises trust.",
	},
	{
		title: "Asking and waiting, at any trust",
		detail: "Choosing not to lean on trust never costs any.",
	},
	{ title: "A question with no pick, or left unanswered" },
];

/** What `row` adds to trust: its evidence for, less its evidence against. */
export function weightOf(row: WeightRow): number {
	if (row.from === undefined) {
		return 0;
	}
	const [source, outcome] = row.from;
	const { alpha, beta } = DECISION_WEIGHTS[source][outcome];
	return alpha - beta;
}

function WeightsCard(): JSX.Element {
	const sections: [string, (weight: number) => boolean][] = [
		["Raises it", (weight) => weight > 0],
		["Lowers it", (weight) => weight < 0],
		["Leaves it alone", (weight) => weight === 0],
	];
	return (
		<Card title="What changes trust" aside="Weights, not points">
			{sections.map(([name, holds]) => {
				const rows = WEIGHT_ROWS.filter((row) => holds(weightOf(row)));
				return (
					rows.length > 0 && (
						<section key={name} aria-label={name}>
							<h4 className="px-4 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
								{name}
							</h4>
							<ul className="divide-y divide-border/60">
								{rows.map((row) => (
									<Row key={row.title} title={row.title} detail={row.detail}>
										<Weight value={weightOf(row)} />
									</Row>
								))}
							</ul>
						</section>
					)
				);
			})}
			<Note className="mt-2">
				How many points a weight moves depends on history: the same{" "}
				<b className="font-semibold">−3</b> moves a model with few decisions
				further than one with many.
			</Note>
		</Card>
	);
}

/** A weight in the hairline badge style: a shield and the signed number, colored. */
function Weight({ value }: { value: number }): JSX.Element {
	const Icon =
		value > 0 ? ShieldPlusIcon : value < 0 ? ShieldMinusIcon : ShieldIcon;
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 pt-px font-semibold text-[13px] tabular-nums",
				value > 0
					? "text-success"
					: value < 0
						? "text-destructive"
						: "text-muted-foreground",
			)}
		>
			<Icon aria-hidden className="size-3.5" />
			{signed(value)}
		</span>
	);
}

/** `+1`, `−2` (a true minus sign), or `0`. */
export function signed(value: number): string {
	return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "0";
}

const BAND_STYLES: Record<
	TrustActionBand,
	{ label: string; pill: string; bar?: string }
> = {
	"ask-and-wait": {
		label: "Ask & wait",
		pill: "bg-warning/15 text-warning",
		bar: "bg-warning/55",
	},
	"ask-and-go": {
		label: "Ask & go",
		pill: "bg-info/12 text-info",
		bar: "bg-info/55",
	},
	assume: {
		label: "Assume",
		pill: "bg-success/12 text-success",
		bar: "bg-success/60",
	},
	any: { label: "Any trust", pill: "bg-muted text-foreground" },
};

/** The score range a band covers, in words. */
function rangeOf(band: TrustActionBand): string | null {
	const index = TRUST_BANDS.indexOf(band as never);
	if (index < 0) {
		return null;
	}
	const next = TRUST_BANDS[index + 1];
	const floor = BAND_FLOORS[band as keyof typeof BAND_FLOORS];
	if (index === 0 && next !== undefined) {
		return `below ${BAND_FLOORS[next]}`;
	}
	if (next !== undefined) {
		return `${floor} to ${BAND_FLOORS[next] - 1}`;
	}
	return `${floor} and up, after ${ASSUME_AFTER} decisions`;
}

function BandsCard(): JSX.Element {
	const bands: TrustActionBand[] = [...TRUST_BANDS, "any"];
	return (
		<Card title="What each band allows">
			<Ruler />
			{bands.map((band) => {
				const style = BAND_STYLES[band];
				const range = rangeOf(band);
				return (
					<section
						key={band}
						aria-label={style.label}
						className="border-t px-4 pt-2.5 pb-3"
					>
						<div className="mb-1 flex items-center gap-2">
							<span
								className={cn(
									"rounded-full px-2 py-px font-medium text-xs",
									style.pill,
								)}
							>
								{style.label}
							</span>
							{range !== null && (
								<span className="text-muted-foreground text-xs">{range}</span>
							)}
						</div>
						<ul className="flex flex-col gap-1">
							{TRUST_ACTIONS.filter((action) => action.band === band).map(
								(action) => (
									<li
										key={action.id}
										className="flex items-start justify-between gap-3 text-[13.5px]"
									>
										<span>{action.label}</span>
										<ActionTag enforced={action.enforced} />
									</li>
								),
							)}
						</ul>
					</section>
				);
			})}
			<Note>
				<b className="font-semibold">Trust is a ceiling, not a floor.</b> An
				agent may ask and wait on any call it judges risky, whatever its score.
				The server never makes it act on trust.
			</Note>
		</Card>
	);
}

/** `Enforced` with a lock when the server refuses otherwise, else `Agents follow`. */
function ActionTag({ enforced }: { enforced: boolean }): JSX.Element {
	return enforced ? (
		<span
			title="The server refuses otherwise"
			className="mt-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border bg-background px-1.5 font-medium text-[11px] leading-[18px]"
		>
			<LockIcon aria-hidden className="size-[11px]" />
			Enforced
		</span>
	) : (
		<span
			title="The agent skill asks for it; the server does not check"
			className="mt-px shrink-0 whitespace-nowrap px-1.5 font-medium text-[11px] text-muted-foreground leading-[18px]"
		>
			Agents follow
		</span>
	);
}

/** A 0–100 bar colored by band, its thresholds and the starting score ticked. */
function Ruler(): JSX.Element {
	const floors = TRUST_BANDS.map((band) => BAND_FLOORS[band]);
	const ticks = [
		...new Set([NEUTRAL_TRUST, ...floors.filter((floor) => floor > 0)]),
	];
	return (
		<div
			role="img"
			aria-label={`Trust bands from 0 to 100: ${TRUST_BANDS.map((band, index) => `${BAND_STYLES[band].label} from ${floors[index]}`).join(", ")}`}
			className="relative mx-4 mt-3 mb-2 h-[30px]"
		>
			<div className="flex h-2 overflow-hidden rounded-full">
				{TRUST_BANDS.map((band, index) => (
					<i
						key={band}
						className={cn("block h-full", BAND_STYLES[band].bar)}
						style={{
							width: `${(floors[index + 1] ?? 100) - BAND_FLOORS[band]}%`,
						}}
					/>
				))}
			</div>
			<Tick at={0} align="start">
				0
			</Tick>
			{ticks.map((at) => (
				<Tick key={at} at={at}>
					{at === NEUTRAL_TRUST ? `${at} start` : at}
				</Tick>
			))}
			<Tick at={100} align="end">
				100
			</Tick>
		</div>
	);
}

function Tick({
	at,
	align = "center",
	children,
}: {
	at: number;
	align?: "start" | "center" | "end";
	children: ReactNode;
}): JSX.Element {
	return (
		<span
			className={cn(
				"absolute top-[13px] whitespace-nowrap text-[11px] text-muted-foreground tabular-nums",
				align === "center" && "-translate-x-1/2",
				align === "end" && "-translate-x-full",
			)}
			style={{ left: `${at}%` }}
		>
			{children}
		</span>
	);
}

function MathCard(): JSX.Element {
	const kinds = Object.values(KIND_LABELS);
	const lines: [string, string][] = [
		[
			"Start",
			`Every model starts at ${NEUTRAL_TRUST}, worth about ${PRIOR_ALPHA + PRIOR_BETA} decisions, so a few kept picks cannot carry it to ${BAND_FLOORS["ask-and-go"]}.`,
		],
		[
			"Score",
			"The share of weight that is for it, as a whole number out of 100.",
		],
		[
			"Recent first",
			`A decision ${DECAY_HALF_LIFE} decisions old counts half as much as the latest one.`,
		],
		[
			"Kinds",
			`${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)} each get their own score; the band uses the overall one.`,
		],
		[
			"Scopes",
			"A decision inside a declared folder moves that folder’s score, not the project’s.",
		],
	];
	return (
		<Card title="How it adds up">
			<dl className="flex flex-col gap-2 px-4 pt-1 pb-3.5 text-[13.5px]">
				{lines.map(([term, text]) => (
					<div key={term} className="flex gap-2.5">
						<dt className="w-[92px] shrink-0 pt-px text-[12.5px] text-muted-foreground">
							{term}
						</dt>
						<dd>{text}</dd>
					</div>
				))}
			</dl>
		</Card>
	);
}

const CONTROLS: [string, string][] = [
	[
		"Undo trust effect",
		"On any event line with a shield: drops that one decision from the score.",
	],
	[
		"Static",
		`Pins a score. A static ${BAND_FLOORS.assume} assumes at once, with no history needed.`,
	],
	[
		"Dynamic, with a set start",
		"Starts the score from the value you pick; earlier decisions stop pulling it.",
	],
	["Reset", `Back to ${NEUTRAL_TRUST}, forgetting every decision before it.`],
	[
		"Allow trusted decisions: off",
		"Every model asks and waits; scores are kept for when it is on again.",
	],
];

function ControlsCard(): JSX.Element {
	return (
		<Card title="What you control">
			<ul className="divide-y divide-border/60 pb-1">
				{CONTROLS.map(([title, detail]) => (
					<Row key={title} title={title} detail={detail} />
				))}
			</ul>
		</Card>
	);
}

function Card({
	title,
	aside,
	children,
}: {
	title: string;
	aside?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section
			aria-label={title}
			className="overflow-hidden rounded-xl border bg-card"
		>
			<div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1">
				<h3 className="font-semibold text-sm">{title}</h3>
				{aside !== undefined && (
					<p className="text-muted-foreground text-xs">{aside}</p>
				)}
			</div>
			{children}
		</section>
	);
}

function Row({
	title,
	detail,
	children,
}: {
	title: string;
	detail?: string;
	children?: ReactNode;
}): JSX.Element {
	return (
		<li className="flex items-start gap-3 px-4 py-[7px]">
			<div className="min-w-0 flex-1 text-[13.5px]">
				{title}
				{detail !== undefined && (
					<small className="mt-px block text-muted-foreground text-xs">
						{detail}
					</small>
				)}
			</div>
			{children}
		</li>
	);
}

function Note({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<p
			className={cn(
				"mx-4 mb-3.5 rounded-[10px] bg-muted px-3 py-2 text-[13px]",
				className,
			)}
		>
			{children}
		</p>
	);
}
