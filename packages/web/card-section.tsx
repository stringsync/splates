import { type JSX, type ReactNode, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * A labelled section of a card or dialog: the `title` shows as a small-caps
 * label beside the body, or above it in a narrow card. Pass `label` to name
 * the region, and `aside` for a control that sits next to the title. Pass
 * `peek` to let it fold: its title then opens and closes it, and while shut
 * the peek, one line, stands in for the body.
 */
export function CardSection({
	label,
	title,
	aside,
	ruled = true,
	peek,
	open: startsOpen = false,
	className,
	children,
}: {
	label: string;
	title: ReactNode;
	aside?: ReactNode;
	/** Whether a hairline sits above it; false for a card's first section. */
	ruled?: boolean;
	/** What it shows while folded; leave it out for a section that never folds. */
	peek?: ReactNode;
	/** Whether a section that folds starts open. */
	open?: boolean;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const [open, setOpen] = useState(startsOpen);
	const folds = peek !== undefined;
	const shut = folds && !open;
	const toggle = () => setOpen((was) => !was);
	return (
		<section
			aria-label={label}
			className={cn(
				"grid min-w-0 gap-x-6 gap-y-2 py-5 last:pb-0 @md:grid-cols-[6.5rem_1fr]",
				ruled ? "border-t" : "pt-0",
				className,
			)}
		>
			<h2
				className={cn(
					"flex flex-wrap items-center gap-2 font-semibold text-[0.7rem] text-muted-foreground uppercase leading-relaxed tracking-[0.08em] @md:flex-col @md:items-start @md:gap-1",
					folds && open && "text-foreground",
				)}
			>
				{folds ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={toggle}
						className="cursor-pointer text-left uppercase tracking-[inherit] hover:text-foreground"
					>
						{title}
					</button>
				) : (
					title
				)}
				{aside}
			</h2>
			{shut ? (
				<button
					type="button"
					tabIndex={-1}
					aria-hidden
					onClick={toggle}
					className="block min-w-0 cursor-pointer truncate text-left text-muted-foreground leading-relaxed hover:text-foreground"
				>
					{peek}
				</button>
			) : (
				<div className="min-w-0 leading-relaxed">{children}</div>
			)}
		</section>
	);
}
