import { FolderIcon, LaptopIcon } from "lucide-react";
import type { JSX } from "react";
import type { Scope } from "../creds";

/**
 * What the page calls a scope: the project by its name, or every project.
 * Never "this device", since the page may be open on a phone while the cred
 * is kept on the machine `arbor dev` runs on.
 */
export function scopeLabel(scope: Scope, project: string): string {
	return scope === "project" ? project : "all projects";
}

/** Where a cred is kept: this project, by its name, or every project. */
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
					: "Kept for every project on the machine arbor dev runs on"
			}
		>
			<Icon className="size-3" />
			{scopeLabel(scope, project)}
		</span>
	);
}
