import {
	type PlanField,
	type PlanTag,
	planFields,
	planTags,
} from "@splates/server/plans/browser";
import {
	BookIcon,
	BoxIcon,
	CrosshairIcon,
	DatabaseIcon,
	DollarSignIcon,
	FlameIcon,
	FlaskConicalIcon,
	GlobeIcon,
	Layers2Icon,
	LayersIcon,
	LockIcon,
	type LucideIcon,
	MonitorIcon,
	PackageIcon,
	ServerIcon,
	SettingsIcon,
	ShieldIcon,
	SquareIcon,
	TagIcon,
	TerminalIcon,
	TriangleAlertIcon,
	Undo2Icon,
	WrenchIcon,
} from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { CardSection } from "./card-section";
import { CardBody } from "./card-shell";
import { Markdown } from "./markdown";

export { type PlanField, type PlanTag, planFields, planTags };

/**
 * A plan's body. The Goal leads in larger type; Details and any other field
 * follow under `CardSection` labels, Details as rows when each bullet leads
 * with a bold action; Tags list each tag with its icon and reason. A body
 * with no fields draws as plain markdown.
 */
export function PlanBody({ text }: { text: string }): JSX.Element {
	const plan = planFields(text);
	if (plan === null) {
		return <CardBody text={text} />;
	}
	const goal = plan.fields.find((field) => /^goal$/i.test(field.label));
	const others = plan.fields.filter((field) => field !== goal);
	return (
		<>
			<div className="flex flex-col gap-0 px-4 py-3.5 @max-md:py-2.5">
				{plan.lead !== "" && (
					<Markdown text={plan.lead} className={cn(PROSE, "pb-4")} />
				)}
				{goal !== undefined && (
					<CardSection label="Goal" title="Goal" ruled={plan.lead !== ""}>
						<Markdown
							text={goal.body}
							className={cn(
								PROSE,
								"font-medium text-[0.95rem] text-foreground",
							)}
						/>
					</CardSection>
				)}
				{others.map((field, i) => (
					<CardSection
						// biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
						key={i}
						label={field.label}
						title={field.label}
						ruled={goal !== undefined || plan.lead !== "" || i > 0}
					>
						{/^tags$/i.test(field.label) ? (
							<PlanTags tags={planTags(field.body)} />
						) : (
							<Markdown
								text={field.body}
								className={cn(PROSE, leadsWithActions(field.body) && ROWS)}
							/>
						)}
					</CardSection>
				))}
			</div>
			{plan.rest !== "" && <CardBody text={plan.rest} />}
		</>
	);
}

function PlanTags({ tags }: { tags: PlanTag[] }): JSX.Element {
	return (
		<ul className="flex flex-col gap-2 text-sm leading-relaxed">
			{tags.map((tag, i) => {
				const look = tagLook(tag.name);
				const Icon = look.icon;
				return (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: tags may repeat
						key={i}
						className="grid grid-cols-[1rem_1fr] gap-x-2.5 @md:grid-cols-[1rem_8.5rem_1fr]"
					>
						<Icon aria-hidden className={cn("mt-[0.2rem] size-4", look.tone)} />
						<span className="font-semibold">{tag.name}</span>
						{tag.why !== "" && (
							<Markdown
								inline
								text={tag.why}
								className="col-start-2 text-muted-foreground @md:col-start-3 [&_code]:whitespace-nowrap"
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** Whether every bullet in `body` leads with a bold action, so Details draws as rows. */
export function leadsWithActions(body: string): boolean {
	const bullets = body.split("\n").filter((line) => /^[-*] /.test(line));
	return (
		bullets.length > 0 && bullets.every((line) => /^[-*] \*\*[^*]/.test(line))
	);
}

/** Details as rows: no bullets, a rule between items, the bold lead dark and the rest muted. */
const ROWS =
	"text-muted-foreground [&_li]:border-t [&_li]:py-2 [&_li:first-child]:border-t-0 [&_li:first-child]:pt-0 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-none [&_ul]:space-y-0 [&_ul]:pl-0";

type Tone = "good" | "warn" | "bad" | "muted";

const TONES: Record<Tone, string> = {
	good: "text-emerald-600 dark:text-emerald-400",
	warn: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
	muted: "text-muted-foreground",
};

/**
 * The fixed set of plan tags (plus legacy multi-word aliases for existing
 * threads), by lowercased name, with each tag's icon and semantic tone.
 */
const TAGS: Record<string, { icon: LucideIcon; tone: Tone }> = {
	reversible: { icon: Undo2Icon, tone: "muted" },
	"clean revert": { icon: Undo2Icon, tone: "muted" },
	cleanup: { icon: WrenchIcon, tone: "muted" },
	"revert + cleanup": { icon: WrenchIcon, tone: "muted" },
	"one-way": { icon: LockIcon, tone: "bad" },
	small: { icon: SquareIcon, tone: "good" },
	medium: { icon: Layers2Icon, tone: "warn" },
	complex: { icon: LayersIcon, tone: "bad" },
	"self-contained": { icon: BoxIcon, tone: "muted" },
	targeted: { icon: CrosshairIcon, tone: "muted" },
	invasive: { icon: FlameIcon, tone: "bad" },
	ui: { icon: MonitorIcon, tone: "muted" },
	"ui only": { icon: MonitorIcon, tone: "muted" },
	cli: { icon: TerminalIcon, tone: "muted" },
	server: { icon: ServerIcon, tone: "muted" },
	database: { icon: DatabaseIcon, tone: "muted" },
	fullstack: { icon: GlobeIcon, tone: "muted" },
	"full stack": { icon: GlobeIcon, tone: "muted" },
	devops: { icon: SettingsIcon, tone: "muted" },
	evals: { icon: FlaskConicalIcon, tone: "muted" },
	skill: { icon: BookIcon, tone: "muted" },
	library: { icon: PackageIcon, tone: "muted" },
	breaking: { icon: TriangleAlertIcon, tone: "bad" },
	security: { icon: ShieldIcon, tone: "bad" },
	paid: { icon: DollarSignIcon, tone: "warn" },
	"costs money": { icon: DollarSignIcon, tone: "warn" },
};

/** A tag's look: the fixed set's, matched with or without "until …" after it, or a plain tag. */
export function tagLook(name: string): { icon: LucideIcon; tone: string } {
	const key = name.toLowerCase().replace(/\s+until\b.*$/, "");
	const known = TAGS[key];
	return known === undefined
		? { icon: TagIcon, tone: TONES.muted }
		: { icon: known.icon, tone: TONES[known.tone] };
}

/** Inline code in a plan stays on one line, never split at a dash. */
const PROSE =
	"text-sm leading-relaxed [&_:not(pre)>code]:whitespace-nowrap [&_ul]:space-y-1.5";
