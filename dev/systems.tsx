import { ChevronRightIcon, LayersIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { NamedSystem } from "../systems";

/**
 * The systems a task touches, under the actions card: by name, since the card
 * answers "what parts of the code is this in", not "how much", each opening
 * in place to the globs it is made of. Nothing at all when it touches none.
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
			<SystemList systems={systems} />
		</section>
	);
}

/**
 * The card as an icon, beside `ActionButtons` in a conversation too narrow
 * for the card, opening the same list.
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
				<PopoverContent align="end" className="w-60 gap-0 p-0 py-1">
					<SystemList systems={systems} />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function SystemList({ systems }: { systems: NamedSystem[] }): JSX.Element {
	return (
		<ul>
			{systems.map((system) => (
				<SystemRow key={system.name} system={system} />
			))}
		</ul>
	);
}

/**
 * A system by name, opening to its globs, those it ignores faded after them
 * with a `!`, as a `.gitignore` writes them.
 */
function SystemRow({ system }: { system: NamedSystem }): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<li>
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
					<span
						aria-hidden
						className="size-2 shrink-0 rounded-full"
						style={{ backgroundColor: dot(system.name) }}
					/>
					<span className="flex-1 truncate">{system.name}</span>
					<ChevronRightIcon
						aria-hidden
						className="size-3.5 text-muted-foreground transition-transform in-aria-expanded:rotate-90"
					/>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<ul
						aria-label={`${system.name} globs`}
						className="flex flex-col gap-0.5 pt-0.5 pr-3 pb-2 pl-7 font-mono text-muted-foreground text-xs"
					>
						{system.globs.map((glob) => (
							<li key={glob} className="break-all">
								{glob}
							</li>
						))}
						{(system.ignore ?? []).map((glob) => (
							<li
								key={`!${glob}`}
								className="break-all text-muted-foreground/60"
							>
								!{glob}
							</li>
						))}
					</ul>
				</CollapsibleContent>
			</Collapsible>
		</li>
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
