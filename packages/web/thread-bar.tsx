import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { JSX, ReactNode, Ref } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { TONES, type Tone } from "./card-shell";

/** Visual and interaction mode for `ThreadBar`'s trailing CTA. */
export type ThreadBarCtaKind = "navigation" | "action";

/** Props for `ThreadBar`, the unified single-line bar in conversation threads. */
export interface ThreadBarProps {
	/** Leading icon, tinted by `iconTone`. */
	Icon: LucideIcon;
	/** Semantic tone coloring the leading icon. Defaults to `"neutral"`. */
	iconTone?: Tone;
	/** Single-line text truncated with an ellipsis when narrow. */
	label: ReactNode;
	/** Trailing CTA label; omitted for read-only bars. */
	cta?: string;
	/**
	 * `"navigation"` (default) makes the whole bar clickable with quiet ghost
	 * text and a chevron; `"action"` keeps the bar static and renders a compact
	 * secondary button without a chevron.
	 */
	ctaKind?: ThreadBarCtaKind;
	/** Click handler when rendered as an interactive bar or action button. */
	onPress?: () => void;
	/** Destination URL when rendered as a link. */
	href?: string;
	/** Accessible label override for the bar or action button. */
	"aria-label"?: string;
	/** Tooltip shown on hover. */
	title?: string;
	disabled?: boolean;
	className?: string;
	ref?: Ref<HTMLButtonElement | HTMLAnchorElement | HTMLDivElement>;
}

/**
 * A single-line bar in a conversation thread: one uniform card surface with
 * strictly three slots (leading icon, single truncated line, and an optional
 * trailing CTA). Navigation bars render as a clickable link or button with
 * quiet ghost text and a chevron; action bars keep the bar static and render a
 * compact secondary button with no chevron.
 */
export function ThreadBar({
	Icon,
	iconTone = "neutral",
	label,
	cta,
	ctaKind = "navigation",
	onPress,
	href,
	"aria-label": ariaLabel,
	title,
	disabled = false,
	className,
	ref,
}: ThreadBarProps): JSX.Element {
	const action = ctaKind === "action";
	const interactive = !action && (href !== undefined || onPress !== undefined);
	const classes = cn(
		"@container group/bar flex min-h-11 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border bg-card px-4 text-left text-card-foreground text-sm shadow-xs",
		action ? "py-2" : "py-2.5",
		interactive &&
			"outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40 active:bg-muted/60 disabled:pointer-events-none disabled:opacity-50",
		className,
	);
	const trailing =
		cta === undefined ? null : action ? (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				aria-label={ariaLabel}
				disabled={disabled}
				onClick={onPress}
			>
				{cta}
			</Button>
		) : (
			<span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[0.8rem] text-muted-foreground transition-colors group-hover/bar:text-foreground">
				{cta}
				<ChevronRightIcon aria-hidden className="size-4" />
			</span>
		);
	const body = (
		<>
			<Icon
				aria-hidden
				className={cn("size-4 shrink-0", TONES[iconTone].icon)}
			/>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
		</>
	);
	if (!action && href !== undefined) {
		return (
			<a
				ref={ref as Ref<HTMLAnchorElement>}
				href={href}
				aria-label={ariaLabel}
				title={title}
				data-thread-bar
				onClick={onPress}
				className={classes}
			>
				{body}
			</a>
		);
	}
	if (!action && onPress !== undefined) {
		return (
			<button
				ref={ref as Ref<HTMLButtonElement>}
				type="button"
				aria-label={ariaLabel}
				title={title}
				data-thread-bar
				disabled={disabled}
				onClick={onPress}
				className={classes}
			>
				{body}
			</button>
		);
	}
	return (
		<div
			ref={ref as Ref<HTMLDivElement>}
			title={title}
			data-thread-bar
			className={classes}
		>
			{body}
		</div>
	);
}
