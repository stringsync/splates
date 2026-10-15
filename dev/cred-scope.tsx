import { FolderIcon, LaptopIcon } from "lucide-react";
import type { JSX } from "react";
import type { Scope } from "../creds";

/** Where a cred is kept: this project, by its name, or the whole device. */
export function ScopeChip({
	scope,
	project,
}: {
	scope: Scope;
	project: string;
}): JSX.Element {
	const Icon = scope === "project" ? FolderIcon : LaptopIcon;
	return (
		<span
			className="inline-flex items-center gap-1 text-muted-foreground text-xs"
			title={
				scope === "project"
					? "Kept for this project"
					: "Kept for every project on this device"
			}
		>
			<Icon className="size-3" />
			{scope === "project" ? project : "this device"}
		</span>
	);
}
