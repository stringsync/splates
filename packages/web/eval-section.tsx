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
		<section aria-label={label} className="flex min-w-0 flex-col gap-3">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((now) => !now)}
				className="flex w-full items-center gap-2 border-b pb-2 text-left"
			>
				<ChevronDownIcon
					aria-hidden
					className={`size-5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
				/>
				<h2 className="font-semibold text-lg tracking-tight">{title}</h2>
				{count !== undefined && (
					<span className="rounded-full bg-muted px-2 text-muted-foreground text-xs tabular-nums">
						{count}
					</span>
				)}
			</button>
			{open && about !== undefined && (
				<p className="text-muted-foreground text-xs">{about}</p>
			)}
			{open && <div className="flex flex-col gap-3">{children}</div>}
		</section>
	);
}
