import type { JSX, ReactNode } from "react";

/**
 * One titled section of the Evals page: a card under a tinted header with a
 * count pill, so the sections stand apart from each other.
 */
export function EvalSection({
	label,
	title,
	count,
	about,
	children,
}: {
	label: string;
	title: string;
	count?: number;
	about?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section
			aria-label={label}
			className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
				<h2 className="font-semibold text-sm">{title}</h2>
				{count !== undefined && (
					<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs tabular-nums">
						{count}
					</span>
				)}
			</div>
			{about !== undefined && (
				<p className="px-4 pt-2 text-muted-foreground text-xs">{about}</p>
			)}
			<div className="px-4 py-1">{children}</div>
		</section>
	);
}
