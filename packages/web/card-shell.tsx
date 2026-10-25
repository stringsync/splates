import type { TaskReport } from "@stringsync/splates-server/plans";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	HourglassIcon,
	type LucideIcon,
	PauseIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { WIDE } from "./app-nav";
import { Markdown } from "./markdown";
import { TaskOnto } from "./task-onto";

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

export function CardShell({
	label,
	Icon,
	title,
	tone = "neutral",
	task,
	base = null,
	aside,
	folded = false,
	ringed = true,
	children,
}: {
	label: string;
	Icon: LucideIcon;
	title: string;
	tone?: Tone;
	task?: string;
	/** Where the task merges, shown after it. */
	base?: string | null;
	/** At the header's end. */
	aside?: ReactNode;
	/** Whether it starts closed, opened by its header: once it is answered. */
	folded?: boolean;
	/**
	 * Whether it is ringed in its tone while focus is inside it; off for a
	 * card that marks the part of it with the focus instead.
	 */
	ringed?: boolean;
	children?: ReactNode;
}): JSX.Element {
	// Ringed in its tone while focus is inside it, as when it comes up to be
	// answered, so it is plain where the keys go.
	const frame = cn(
		"group/card overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-[border-color,box-shadow] duration-150",
		CARD_SPACE,
		ringed && ["focus-within:ring-3", TONES[tone].focus],
	);
	const header = (
		<Header
			Icon={Icon}
			title={title}
			tone={tone}
			task={task}
			base={base}
			aside={aside}
			folded={folded}
			ruled={children !== undefined}
		/>
	);
	if (folded) {
		return (
			<Collapsible
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
			<header>{header}</header>
			{children}
		</section>
	);
}

/** How a card's header is tinted: by what the person is to make of it. */
export type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

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
};

/** How each ending shows: on its report card, and beside its conversation. */
export const ENDINGS: Record<
	TaskReport["ending"],
	{ title: string; Icon: LucideIcon; tone: Tone }
> = {
	// Both are work over, so they share the check; a merge's report card
	// titles itself Done and names what merged in its body.
	merged: { title: "Merged", Icon: CircleCheckIcon, tone: "success" },
	done: { title: "Done", Icon: CircleCheckIcon, tone: "success" },
	removed: { title: "Removed", Icon: CircleSlashIcon, tone: "destructive" },
	deferred: { title: "Deferred", Icon: PauseIcon, tone: "warning" },
	// From before escalating was retired.
	escalated: {
		title: "Escalated",
		Icon: TriangleAlertIcon,
		tone: "warning",
	},
	working: { title: "Working", Icon: HourglassIcon, tone: "neutral" },
};

/** What a report says: why it went, or what it waits on, leading the rest. */
export function reportText(report: TaskReport): string {
	return [report.reason, report.body]
		.filter((each) => each !== null && each !== "")
		.join("\n\n");
}

/**
 * Scrolls `card` to its top, just clear of the person's message stuck atop
 * its turn, with the fade `::after` paints below it, where it sticks (not on
 * a phone), so a card that comes up or takes the focus reads from its start.
 */
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
	ruled,
}: {
	Icon: LucideIcon;
	title: string;
	tone: Tone;
	task: string | undefined;
	base: string | null;
	aside: ReactNode;
	folded: boolean;
	/** Whether a body follows, set apart by a rule while it shows. */
	ruled: boolean;
}): JSX.Element {
	return (
		<div
			className={cn(
				// Tighter in a narrow thread, as on a phone.
				"flex flex-wrap items-center gap-2 px-4 py-2.5 @max-md:px-3 @max-md:py-2",
				ruled && (folded ? "group-data-[open]/card:border-b" : "border-b"),
				TONES[tone].header,
			)}
		>
			{folded && (
				<ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-150 group-data-[open]/card:rotate-90" />
			)}
			<Icon className={cn("size-4", TONES[tone].icon)} />
			<span className="font-medium text-[13px]">{title}</span>
			{/* In a narrow thread the chips take a row of their own beneath, so
			    the aside stays beside the title rather than wrapping alone. */}
			{task !== undefined && (
				<TaskOnto
					task={task}
					base={base}
					className="@max-md:order-last @max-md:basis-full"
				/>
			)}
			{aside !== undefined && <span className="ml-auto">{aside}</span>}
		</div>
	);
}

/**
 * A card's markdown body, its margins kept inside the card. A `####` section
 * states its point in a sentence, so it reads as one, not as a quiet label.
 */
export function CardBody({
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
				"px-4 py-3.5 text-sm leading-relaxed @max-md:px-3 @max-md:py-2.5 [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
				"[&_h4]:mt-4 [&_h4]:mb-1 [&_h4:first-child]:mt-0 [&_h4]:font-semibold [&_h4]:text-sm [&_h4]:normal-case [&_h4]:tracking-normal [&_h4]:opacity-100",
				lead &&
					"[&_p:first-child]:font-medium [&_p:first-child]:first-letter:uppercase",
				className,
			)}
		/>
	);
}
