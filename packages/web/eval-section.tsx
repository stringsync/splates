import { ChevronDownIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";

/**
 * One titled section of the Evals page, with a count pill. Click its header
 * to collapse or expand it; pass `defaultOpen={false}` to start it collapsed.
 */
export function EvalSection({
	label,
	title,
	count,
	about,
	defaultOpen = true,
	children,
}: {
	label: string;
	title: string;
	count?: number;
	about?: string;
	defaultOpen?: boolean;
	children: ReactNode;
}): JSX.Element {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section
			aria-label={label}
			className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((now) => !now)}
				className={`flex w-full items-center gap-2 bg-muted/40 px-4 py-2 text-left ${open ? "border-b" : ""}`}
			>
				<ChevronDownIcon
					aria-hidden
					className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
				/>
				<h2 className="font-semibold text-sm">{title}</h2>
				{count !== undefined && (
					<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs tabular-nums">
						{count}
					</span>
				)}
			</button>
			{open && about !== undefined && (
				<p className="px-4 pt-2 text-muted-foreground text-xs">{about}</p>
			)}
			{open && <div className="px-4 py-1">{children}</div>}
		</section>
	);
}
