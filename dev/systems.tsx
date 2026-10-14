import { LayersIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { NamedSystem } from "../systems";

/**
 * The systems a task touches, under the actions card: by name, since the card
 * answers "what parts of the code is this in", not "how much", each as the
 * chip a message shows for its `#name`, opening to the globs it is made of.
 * Nothing at all when it touches none.
 */
export function SystemsCard({
	systems,
}: {
	systems: NamedSystem[];
}): JSX.Element | null {
	if (systems.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="systems"
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<LayersIcon />
				Systems
			</h3>
			<SystemChips systems={systems} className="px-3 pt-0.5 pb-2" />
		</section>
	);
}

/**
 * The card as an icon, beside `ActionButtons` in a conversation too narrow
 * for the card, opening the same chips.
 */
export function SystemsButton({
	systems,
}: {
	systems: NamedSystem[];
}): JSX.Element | null {
	if (systems.length === 0) {
		return null;
	}
	return (
		<div className="@min-[76rem]:hidden">
			<Popover>
				<PopoverTrigger
					render={
						<Button
							variant="outline"
							size="icon-sm"
							aria-label="Systems"
							title={`Systems: ${systems.map((system) => system.name).join(", ")}`}
						/>
					}
				>
					<LayersIcon />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-60 p-3">
					<SystemChips systems={systems} />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function SystemChips({
	systems,
	className = "",
}: {
	systems: NamedSystem[];
	className?: string;
}): JSX.Element {
	return (
		<ul className={`flex flex-wrap gap-1 ${className}`}>
			{systems.map((system) => (
				<li key={system.name} className="flex min-w-0">
					<SystemChip system={system} />
				</li>
			))}
		</ul>
	);
}

/**
 * A system a message mentions as `#name`: its color and name, opening to its
 * aliases and the globs it is made of.
 */
export function SystemChip({ system }: { system: NamedSystem }): JSX.Element {
	const aliases = system.aliases ?? [];
	return (
		<Popover>
			<PopoverTrigger
				onClick={(event) => event.stopPropagation()}
				className="inline-flex h-6 max-w-full cursor-pointer items-center gap-1.5 rounded-md border px-1.5 align-middle font-mono text-foreground/90 text-xs hover:bg-muted"
			>
				<span
					aria-hidden
					className="size-2 shrink-0 rounded-full"
					style={{ backgroundColor: dot(system.name) }}
				/>
				<span className="min-w-0 truncate">{system.name}</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 gap-1 p-3">
				<div className="flex items-center gap-2 font-medium text-sm">
					<LayersIcon aria-hidden className="size-4 text-muted-foreground" />
					{system.name}
				</div>
				{aliases.length > 0 && (
					<p className="text-muted-foreground text-xs">
						Also {aliases.join(", ")}
					</p>
				)}
				<Globs system={system} className="pt-1" />
			</PopoverContent>
		</Popover>
	);
}

/** The globs `system` is made of, those it ignores faded after them with a `!`. */
function Globs({
	system,
	className,
}: {
	system: NamedSystem;
	className: string;
}): JSX.Element {
	return (
		<ul
			aria-label={`${system.name} globs`}
			className={`flex flex-col gap-0.5 font-mono text-muted-foreground text-xs ${className}`}
		>
			{system.globs.map((glob) => (
				<li key={glob} className="break-all">
					{glob}
				</li>
			))}
			{(system.ignore ?? []).map((glob) => (
				<li key={`!${glob}`} className="break-all text-muted-foreground/60">
					!{glob}
				</li>
			))}
		</ul>
	);
}

/**
 * A system's color, the same wherever it shows: a hue from its name, at one
 * lightness and chroma, so no two read as louder than each other.
 */
export function dot(name: string): string {
	let hash = 0;
	for (const char of name) {
		hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
	}
	return `oklch(0.7 0.14 ${hash % 360})`;
}
