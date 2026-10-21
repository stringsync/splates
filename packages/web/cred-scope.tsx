import type { Provider, Scope } from "@stringsync/splates-server/creds";
import { CloudIcon, FolderIcon, LaptopIcon } from "lucide-react";
import type { JSX } from "react";

/**
 * What the page calls a scope: the project by its name, or every project.
 * Never "this device", since the page may be open on a phone while the cred
 * is kept on the machine `splates server` runs on.
 */
export function scopeLabel(scope: Scope, project: string): string {
	return scope === "project" ? project : "all projects";
}

/** What the page calls a provider of creds. */
export function providerLabel(provider: Provider): string {
	return provider === "ssm" ? "AWS Parameter Store" : "this machine";
}

/**
 * Which provider keeps a cred, as the buttons of a segmented control. Offers
 * nothing when there is only one to pick.
 */
export function ProviderPicker({
	providers,
	provider,
	onPick,
}: {
	providers: Provider[];
	provider: Provider;
	onPick: (provider: Provider) => void;
}): JSX.Element | null {
	if (providers.length < 2) {
		return null;
	}
	return (
		<fieldset className="flex rounded-md border p-0.5">
			<legend className="sr-only">Kept by</legend>
			{providers.map((each) => (
				<button
					key={each}
					type="button"
					aria-pressed={each === provider}
					onClick={() => onPick(each)}
					className="rounded px-2 py-0.5 text-muted-foreground text-xs outline-none max-md:px-3 max-md:py-1.5 max-md:text-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-foreground"
				>
					{providerLabel(each)}
				</button>
			))}
		</fieldset>
	);
}

/**
 * Where a cred is kept: this project, by its name, or every project, and,
 * when it is not the machine's own store, the provider keeping it.
 */
export function ScopeChip({
	scope,
	project,
	provider = "system",
}: {
	scope: Scope;
	project: string;
	provider?: Provider;
}): JSX.Element {
	const Icon = scope === "project" ? FolderIcon : LaptopIcon;
	return (
		<span
			className="inline-flex items-center gap-1 text-muted-foreground text-xs"
			title={
				scope === "project"
					? "Kept for this project"
					: "Kept for every project on the machine splates server runs on"
			}
		>
			<Icon className="size-3" />
			{scopeLabel(scope, project)}
			{provider !== "system" && (
				<>
					<CloudIcon className="ml-1 size-3" />
					{providerLabel(provider)}
				</>
			)}
		</span>
	);
}
