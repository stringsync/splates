import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Render a breadcrumb. Give parent items an onClick callback and leave the current item without one. */
export function RouteTrail({
	items,
}: {
	items: { label: string; onClick?: () => void }[];
}): ReactNode {
	return (
		<nav aria-label="Breadcrumb" className="min-w-0">
			<ol className="flex min-w-0 items-center gap-1 text-sm">
				{items.map((item, index) => (
					<li key={item.label} className="flex min-w-0 items-center gap-1">
						{index > 0 && (
							<ChevronRightIcon
								aria-hidden
								className="size-3 shrink-0 text-muted-foreground"
							/>
						)}
						{item.onClick ? (
							<button
								type="button"
								onClick={item.onClick}
								className="min-h-9 truncate rounded text-muted-foreground hover:text-foreground focus-visible:outline-ring"
								title={item.label}
							>
								{item.label}
							</button>
						) : (
							<h2
								aria-current="page"
								className="truncate font-medium"
								title={item.label}
							>
								{item.label}
							</h2>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}
