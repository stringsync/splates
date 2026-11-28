import type { TaskReport } from "@splates/server/plans";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	type LucideIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { WIDE } from "./app-nav";
import { CardSection } from "./card-section";
import { Markdown } from "./markdown";
import { Sheeted, useInSheet, useSheeted } from "./phone-sheets";
import { TaskOnto } from "./task-onto";

export {
	CardFooter,
	type CardFooterAction,
	type CardFooterActionTone,
	type CardFooterProps,
} from "./card-footer";

/** Mobile sheet presentation options for `CardShell`. */
export type CardSheetOption =
	| boolean
	| {
			title?: string;
			action?: string;
			/** Open in a sheet even when not waiting on a reply. Defaults to true. */
			always?: boolean;
			/** Whether this card is waiting on user action (`NeedsYouBar`). Defaults to false. */
			waiting?: boolean;
	  };

/**
 * The frame every card in a conversation shares: a header with an icon, what
 * the card is, and the task it is about, then whatever the card holds. A
 * folded card shows only its header until it is opened.
 */
/**
 * The room above and below a card in a thread, apart from the agent's words
 * around it: more than between two paragraphs, so a card never reads as one.
 */
export const CARD_SPACE = "my-6 @max-md:my-4";

export function CardShell(props: {
	label: string;
	Icon: LucideIcon;
	title: ReactNode;
	tone?: Tone;
	task?: string;
	/** Where the task merges, shown after it. */
	base?: string | null;
	/** At the header's end. */
	aside?: ReactNode;
	/** Whether it starts closed, opened by its header: once it is answered. */
	folded?: boolean;
	/** Keep header contents vertically centered in narrow threads too. */
	centerHeader?: boolean;
	/** Whether its header folds and unfolds it even when it starts open. */
	foldable?: boolean;
	/**
	 * Whether it is ringed in its tone while focus is inside it; off for a
	 * card that marks the part of it with the focus instead.
	 */
	ringed?: boolean;
	/**
	 * Opt into mobile sheet presentation inside `PhoneSheets`: collapses to a
	 * single-line `ThreadBar` on mobile and opens the full card in a sheet.
	 */
	sheet?: CardSheetOption;
	children?: ReactNode;
}): JSX.Element {
	const sheeted = useSheeted();
	const inSheet = useInSheet();
	const { label, Icon, title, tone = "neutral", aside, sheet = false } = props;
	if (sheet && sheeted && !inSheet) {
		const config = typeof sheet === "object" ? sheet : {};
		const sheetTitle =
			config.title ?? (typeof title === "string" ? title : label);
		return (
			<Sheeted
				title={sheetTitle}
				subtitle={aside}
				Icon={Icon}
				tone={tone}
				action={config.action ?? "Open"}
				always={config.always ?? true}
				waiting={config.waiting ?? false}
			>
				<CardFrame {...props} />
			</Sheeted>
		);
	}
	return <CardFrame {...props} />;
}

function CardFrame({
	label,
	Icon,
	title,
	tone = "neutral",
	task,
	base = null,
	aside,
	folded = false,
	centerHeader = false,
	foldable = false,
	ringed = true,
	children,
}: {
	label: string;
	Icon: LucideIcon;
	title: ReactNode;
	tone?: Tone;
	task?: string;
	base?: string | null;
	aside?: ReactNode;
	folded?: boolean;
	centerHeader?: boolean;
	foldable?: boolean;
	ringed?: boolean;
	children?: ReactNode;
}): JSX.Element {
	const inSheet = useInSheet();
	// Folded again whenever `folded` turns on, opened whenever it turns off;
	// the header toggles it in between.
	const [open, setOpen] = useState(!folded);
	const [wasFolded, setWasFolded] = useState(folded);
	if (wasFolded !== folded) {
		setWasFolded(folded);
		setOpen(!folded);
	}
	const collapsible = folded || foldable;
	// Ringed in its tone while focus is inside it, as when it comes up to be
	// answered, so it is plain where the keys go.
	const frame = cn(
		"group/card isolate overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-[border-color,box-shadow] duration-150",
		CARD_SPACE,
		ringed && ["focus-within:ring-3", TONES[tone].focus],
	);
	const header = inSheet ? null : (
		<Header
			Icon={Icon}
			title={title}
			tone={tone}
			task={task}
			base={base}
			aside={aside}
			folded={collapsible}
			centered={centerHeader}
			ruled={children !== undefined}
		/>
	);
	if (collapsible && !inSheet) {
		return (
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				render={<section aria-label={label} data-card />}
				className={frame}
			>
				<CollapsibleTrigger
					nativeButton={false}
					render={<header />}
					className="cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
				>
					{header}
				</CollapsibleTrigger>
				<CollapsibleContent>{children}</CollapsibleContent>
			</Collapsible>
		);
	}
	return (
		<section aria-label={label} data-card className={frame}>
			{header !== null && <header>{header}</header>}
			{children}
		</section>
	);
}

/** How a card's header is tinted: by what the person is to make of it. */
export type Tone =
	| "neutral"
	| "success"
	| "warning"
	| "destructive"
	| "info"
	| "eval"
	| "steps"
	| "plan";

export const TONES: Record<
	Tone,
	{ header: string; icon: string; focus: string }
> = {
	neutral: {
		header: "bg-muted/40",
		icon: "text-muted-foreground",
		focus: "focus-within:border-ring/60 focus-within:ring-ring/20",
	},
	success: {
		header: "bg-success/[0.07]",
		icon: "text-success",
		focus: "focus-within:border-success/50 focus-within:ring-success/15",
	},
	warning: {
		header: "bg-warning/[0.08]",
		icon: "text-warning",
		focus: "focus-within:border-warning/50 focus-within:ring-warning/15",
	},
	destructive: {
		header: "bg-destructive/[0.07]",
		icon: "text-destructive",
		focus:
			"focus-within:border-destructive/50 focus-within:ring-destructive/15",
	},
	info: {
		header: "bg-info/[0.07]",
		icon: "text-info",
		focus: "focus-within:border-info/50 focus-within:ring-info/15",
	},
	// Evals are orange, as automations are violet.
	eval: {
		header: "bg-orange-500/15",
		icon: "text-orange-600 dark:text-orange-400",
		focus: "focus-within:border-orange-500/50 focus-within:ring-orange-500/15",
	},
	// Steps are violet: matches `StepsBody` and `StepsPopped` for user-driven steps.
	steps: {
		header: "bg-violet-500/[0.08]",
		icon: "text-violet-600 dark:text-violet-400",
		focus: "focus-within:border-violet-500/50 focus-within:ring-violet-500/15",
	},
	// Plans are indigo: proposals awaiting approval.
	plan: {
		header: "bg-indigo-500/15",
		icon: "text-indigo-600 dark:text-indigo-300",
		focus: "focus-within:border-indigo-500/50 focus-within:ring-indigo-500/15",
	},
};

/** How each ending shows: on its report card, and beside its conversation. */
export const ENDINGS: Record<
	TaskReport["ending"],
	{ title: string; Icon: LucideIcon; tone: Tone }
> = {
	// Both are work over, so they share the title and check; a merge's body
	// names what merged where.
	merged: { title: "Done", Icon: CircleCheckIcon, tone: "success" },
	done: { title: "Done", Icon: CircleCheckIcon, tone: "success" },
	removed: { title: "Removed", Icon: CircleSlashIcon, tone: "neutral" },
	deferred: { title: "Blocked", Icon: TriangleAlertIcon, tone: "warning" },
	// From before escalating was retired.
	escalated: {
		title: "Escalated",
		Icon: TriangleAlertIcon,
		tone: "warning",
	},
};

/** What a report says: why it went, or what it waits on, leading the rest. */
export function reportText(report: TaskReport): string {
	return [report.reason, report.body]
		.filter((each) => each !== null && each !== "")
		.join("\n\n");
}

/** Bring a card into view at its top when it opens or receives focus. */
export function toCardTop(
	card: HTMLElement,
	behavior: ScrollBehavior = "instant",
): void {
	const stuck = card.closest('[data-slot="aui_turn"]')?.firstElementChild;
	if (
		stuck instanceof HTMLElement &&
		stuck.dataset.role === "user" &&
		matchMedia(WIDE).matches
	) {
		const fade = Number.parseFloat(getComputedStyle(stuck, "::after").height);
		card.style.scrollMarginTop = `${stuck.offsetHeight + (fade || 0)}px`;
	}
	card.scrollIntoView({ block: "start", behavior });
}

function Header({
	Icon,
	title,
	tone,
	task,
	base,
	aside,
	folded,
	centered,
	ruled,
}: {
	Icon: LucideIcon;
	title: ReactNode;
	tone: Tone;
	task: string | undefined;
	base: string | null;
	aside: ReactNode;
	folded: boolean;
	centered: boolean;
	/** Whether a body follows, set apart by a rule while it shows. */
	ruled: boolean;
}): JSX.Element {
	return (
		<div
			className={cn(
				// Uniform 16px horizontal padding on phone and desktop, slightly tighter vertical rhythm on narrow threads.
				"flex flex-wrap items-center gap-2 px-4 py-2.5 @max-md:py-2",
				!centered && "@max-md:items-start",
				ruled && (folded ? "group-data-[open]/card:border-b" : "border-b"),
				TONES[tone].header,
			)}
		>
			{folded && (
				<ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-150 group-data-[open]/card:rotate-90" />
			)}
			<Icon
				className={cn(
					"size-4 shrink-0",
					!centered && "@max-md:mt-px",
					TONES[tone].icon,
				)}
			/>
			{/* Narrow, the title takes the row beside its icon and wraps under
			    itself, rather than dropping below the icon whole. */}
			<span className="font-medium text-[13px] @max-md:min-w-0 @max-md:flex-1 @max-md:basis-0">
				{title}
			</span>
			{/* In a narrow thread the chips take a row of their own beneath, so
			    the aside stays beside the title rather than wrapping alone. */}
			{task !== undefined && (
				<TaskOnto
					task={task}
					base={base}
					className="@max-md:order-last @max-md:basis-full"
				/>
			)}
			{aside !== undefined && (
				<span
					className={cn("ml-auto shrink-0", centered && "flex items-center")}
				>
					{aside}
				</span>
			)}
		</div>
	);
}

/** `text` cut at its headings, outside code fences: a lead and one part per heading. */
export function partsOf(text: string): {
	lead: string;
	parts: { title: string; body: string }[];
} {
	const parts: { title: string; lines: string[] }[] = [];
	const lead: string[] = [];
	let fenced = false;
	for (const line of text.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
		}
		const heading = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading !== null) {
			parts.push({ title: heading[1] ?? "", lines: [] });
		} else {
			(parts.at(-1)?.lines ?? lead).push(line);
		}
	}
	return {
		lead: lead.join("\n").trim(),
		parts: parts.map((each) => ({
			title: each.title,
			body: each.lines.join("\n").trim(),
		})),
	};
}

/**
 * Render a card's markdown with its spacing contained. Each heading in it
 * opens and closes the text under it.
 */
export function CardBody({
	text,
	lead = false,
	follows = false,
	className,
}: {
	text: string;
	/** Whether its first paragraph leads, set in a heavier weight. */
	lead?: boolean;
	/** Whether it comes after other blocks, so its first heading is ruled too. */
	follows?: boolean;
	className?: string;
}): JSX.Element {
	const cut = partsOf(text);
	if (cut.parts.length === 0) {
		return <CardMarkdown text={text} lead={lead} className={className} />;
	}
	return (
		<div
			className={cn(
				"flex flex-col gap-0 px-4 py-3.5 @max-md:py-2.5",
				className,
			)}
		>
			{cut.lead !== "" && (
				<CardMarkdown
					text={cut.lead}
					lead={lead}
					className="p-0 pb-5 @max-md:p-0 @max-md:pb-5"
				/>
			)}
			{cut.parts.map((part, i) => (
				<CardSection
					// biome-ignore lint/suspicious/noArrayIndexKey: headings may repeat
					key={i}
					label={part.title}
					title={part.title}
					ruled={follows || cut.lead !== "" || i > 0}
				>
					{part.body !== "" && (
						<CardMarkdown text={part.body} className="p-0 @max-md:p-0" />
					)}
				</CardSection>
			))}
		</div>
	);
}

function CardMarkdown({
	text,
	lead = false,
	className,
}: {
	text: string;
	/** Whether its first paragraph leads, set in a heavier weight. */
	lead?: boolean;
	className?: string;
}): JSX.Element {
	return (
		<Markdown
			text={text}
			className={cn(
				"px-4 py-3.5 text-sm leading-relaxed @max-md:py-2.5 [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
				"[&_h4]:mt-4 [&_h4]:mb-1 [&_h4:first-child]:mt-0 [&_h4]:font-semibold [&_h4]:text-sm [&_h4]:normal-case [&_h4]:tracking-normal [&_h4]:opacity-100",
				lead &&
					"[&_p:first-child]:font-medium [&_p:first-child]:first-letter:uppercase",
				className,
			)}
		/>
	);
}
