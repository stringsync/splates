import { ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";

/** A call's arguments as small `key: value` chips, none for a bare name. */
export function ArgumentChips({
	args,
}: {
	args: [key: string, value: string][];
}): JSX.Element | null {
	if (args.length === 0) {
		return null;
	}
	return (
		<span className="flex min-w-0 flex-wrap gap-1">
			{args.map(([key, value]) => (
				<span
					key={key}
					title={`${key}: ${value}`}
					className="max-w-48 truncate rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground"
				>
					{key}: {value}
				</span>
			))}
		</span>
	);
}

/** A call's arguments as a two-column table, none for a bare name. */
export function ArgumentTable({
	args,
	collapsed = false,
	className,
}: {
	args: [key: string, value: string][];
	collapsed?: boolean;
	className?: string;
}): JSX.Element | null {
	if (args.length === 0) {
		return null;
	}
	const table = (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 font-mono text-xs">
			{args.map(([key, value]) => (
				<div key={key} className="contents">
					<dt className="text-muted-foreground">{key}</dt>
					<dd className="break-all">{value}</dd>
				</div>
			))}
		</dl>
	);
	return (
		<div className={cn("mx-4 mb-3", className)}>
			{collapsed ? (
				<Collapsible className="group/arguments">
					<CollapsibleTrigger
						render={<Button variant="outline" size="sm" />}
						className="h-11 gap-2 sm:h-8"
					>
						<ChevronRightIcon className="size-4 transition-transform group-data-[open]/arguments:rotate-90" />
						Signal arguments
					</CollapsibleTrigger>
					<CollapsibleContent className="pt-2">
						<div className="rounded-md border bg-muted/30 p-3">{table}</div>
					</CollapsibleContent>
				</Collapsible>
			) : (
				table
			)}
		</div>
	);
}
