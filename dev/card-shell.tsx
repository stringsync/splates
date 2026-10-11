import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import { cn } from "#dev/lib/utils.ts";
import { Markdown } from "./markdown";

/** How a card's header is tinted: by what the person is to make of it. */
export type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

const TONES: Record<Tone, { header: string; icon: string }> = {
	neutral: { header: "bg-muted/40", icon: "text-muted-foreground" },
	success: { header: "bg-success/[0.07]", icon: "text-success" },
	warning: { header: "bg-warning/[0.08]", icon: "text-warning" },
	destructive: { header: "bg-destructive/[0.07]", icon: "text-destructive" },
	info: { header: "bg-info/[0.07]", icon: "text-info" },
};

/**
 * The frame every card in a conversation shares: a header with an icon, what
 * the card is, and the task it is about, then whatever the card holds. A
 * folded card shows only its header until it is opened.
 */
export function CardShell({
	label,
	Icon,
	title,
	tone = "neutral",
	task,
	base = null,
	aside,
	folded = false,
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
	children?: ReactNode;
}): JSX.Element {
	const frame =
		"group/card my-4 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs";
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
			<Collapsible render={<section aria-label={label} />} className={frame}>
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
		<section aria-label={label} className={frame}>
			<header>{header}</header>
			{children}
		</section>
	);
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
				"flex flex-wrap items-center gap-2 px-4 py-2.5",
				ruled && (folded ? "group-data-[open]/card:border-b" : "border-b"),
				TONES[tone].header,
			)}
		>
			{folded && (
				<ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-150 group-data-[open]/card:rotate-90" />
			)}
			<Icon className={cn("size-4", TONES[tone].icon)} />
			<span className="font-medium text-[13px]">{title}</span>
			{task !== undefined && (
				<span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
					<Chip>{task}</Chip>
					{base !== null && (
						<>
							<span aria-hidden>→</span>
							<Chip>{base}</Chip>
						</>
					)}
				</span>
			)}
			{aside !== undefined && <span className="ml-auto">{aside}</span>}
		</div>
	);
}

function Chip({ children }: { children: ReactNode }): JSX.Element {
	return (
		<span className="truncate rounded-md bg-background px-1.5 py-0.5 ring-1 ring-border">
			{children}
		</span>
	);
}

/** A card's markdown body, its margins kept inside the card. */
export function CardBody({
	text,
	lead = false,
}: {
	text: string;
	/** Whether its first paragraph leads, set in a heavier weight. */
	lead?: boolean;
}): JSX.Element {
	return (
		<Markdown
			text={text}
			className={cn(
				"px-4 py-3.5 text-sm leading-relaxed [&_img]:rounded-lg [&_img]:ring-1 [&_img]:ring-border [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
				lead &&
					"[&_p:first-child]:font-medium [&_p:first-child]:first-letter:uppercase",
			)}
		/>
	);
}
