import type { LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/** Props for `WidgetCard`, the shared frame for conversation rail and phone sheet widgets. */
export interface WidgetCardProps {
	/** Accessible name for the widget landmark. */
	label: string;
	/** Semantic container element. Defaults to `"section"`. */
	as?: "section" | "nav";
	/** Leading Lucide icon shown beside the title. */
	Icon?: LucideIcon;
	/** Custom leading icon element (for non-Lucide marks such as an agent badge). */
	icon?: ReactNode;
	/** Widget header title; omit for headerless widgets such as the actions list. */
	title?: ReactNode;
	/** Optional trailing status, badge, or count in the header. */
	aside?: ReactNode;
	className?: string;
	children: ReactNode;
}

/**
 * The shared frame for widgets in the conversation rail and phone widgets
 * sheet: a bordered `data-widget` container with an optional `h-8 px-3` icon
 * and title header above the widget's rows or content.
 */
export function WidgetCard({
	label,
	as: Tag = "section",
	Icon,
	icon,
	title,
	aside,
	className,
	children,
}: WidgetCardProps): JSX.Element {
	return (
		<Tag
			aria-label={label}
			data-widget
			className={cn(
				"shrink-0 overflow-hidden rounded-lg border bg-background py-1",
				className,
			)}
		>
			{title !== undefined && (
				<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm">
					{icon ??
						(Icon !== undefined && (
							<Icon
								aria-hidden
								className="size-4 shrink-0 text-muted-foreground"
							/>
						))}
					<span className="min-w-0 flex-1 truncate">{title}</span>
					{aside !== undefined && (
						<span className="flex shrink-0 items-center gap-1.5 font-normal text-muted-foreground text-xs">
							{aside}
						</span>
					)}
				</h3>
			)}
			{children}
		</Tag>
	);
}
