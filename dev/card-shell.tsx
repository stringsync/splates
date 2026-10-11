import type { LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
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
 * the card is, and the task it is about, then whatever the card holds.
 */
export function CardShell({
	label,
	Icon,
	title,
	tone = "neutral",
	task,
	base = null,
	aside,
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
	children?: ReactNode;
}): JSX.Element {
	return (
		<section
			aria-label={label}
			className="my-4 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs"
		>
			<header
				className={cn(
					"flex flex-wrap items-center gap-2 px-4 py-2.5",
					children !== undefined && "border-b",
					TONES[tone].header,
				)}
			>
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
			</header>
			{children}
		</section>
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
