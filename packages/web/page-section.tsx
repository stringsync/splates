import type { ComponentProps, JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

export type PageSectionProps = Omit<ComponentProps<"section">, "title"> & {
	/** Section heading rendered in the canonical uppercase muted eyebrow style. */
	title?: ReactNode;
	/** Semantic heading level; defaults to `"h2"`. */
	as?: "h2" | "h3";
	/** Accessible `<section>` label; defaults to `title` when `title` is a string. */
	label?: string;
	/** Optional inline count or short metadata rendered beside the title. */
	count?: ReactNode;
	/** Optional right-aligned header slot for status counts, buttons, or toggles. */
	aside?: ReactNode;
	/** Optional lead line rendered directly beneath the header row. */
	description?: ReactNode;
};

/**
 * A page section with the canonical uppercase muted eyebrow heading, optional
 * inline count, right-aligned aside slot, and lead description. Compose with
 * `Card` to wrap a single card, a stack of cards, or a tile grid.
 */
export function PageSection({
	title,
	as = "h2",
	label,
	count,
	aside,
	description,
	className,
	children,
	"aria-label": ariaLabel,
	...props
}: PageSectionProps): JSX.Element {
	const Heading = as;
	const hasTitle =
		title !== undefined && title !== null && title !== false && title !== "";
	const hasCount = count !== undefined && count !== null && count !== false;
	const hasAside = aside !== undefined && aside !== null && aside !== false;
	const hasDescription =
		description !== undefined &&
		description !== null &&
		description !== false &&
		description !== "";
	const hasTopRow = hasTitle || hasCount || hasAside;
	const hasHeader = hasTopRow || hasDescription;
	const regionLabel =
		ariaLabel ??
		label ??
		(typeof title === "string" && title !== "" ? title : undefined);

	return (
		<section
			aria-label={regionLabel}
			data-slot="page-section"
			className={cn("flex min-w-0 flex-col gap-3", className)}
			{...props}
		>
			{hasHeader && (
				<header
					data-slot="page-section-header"
					className="flex min-w-0 flex-col gap-1"
				>
					{hasTopRow && (
						<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
							{(hasTitle || hasCount) && (
								<div className="flex min-w-0 items-baseline gap-2">
									{hasTitle && (
										<Heading className="min-w-0 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
											{title}
										</Heading>
									)}
									{hasCount && (
										<span
											data-slot="page-section-count"
											className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums"
										>
											{count}
										</span>
									)}
								</div>
							)}
							{hasAside && (
								<div
									data-slot="page-section-aside"
									className="ml-auto flex shrink-0 items-center gap-2"
								>
									{typeof aside === "string" || typeof aside === "number" ? (
										<span className="text-muted-foreground text-xs tabular-nums">
											{aside}
										</span>
									) : (
										aside
									)}
								</div>
							)}
						</div>
					)}
					{hasDescription && (
						<p
							data-slot="page-section-description"
							className="text-muted-foreground text-xs leading-relaxed"
						>
							{description}
						</p>
					)}
				</header>
			)}
			{children}
		</section>
	);
}
