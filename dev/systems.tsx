import { LayersIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { NamedSystem } from "../systems";
import type { BarAction } from "./top-bar";

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
			data-widget
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
 * The card as an action of a bar, opening the same chips, for a page too
 * narrow to show the card; null with no systems.
 */
export function systemsAction(systems: NamedSystem[]): BarAction | null {
	if (systems.length === 0) {
		return null;
	}
	return {
		label: "Systems",
		icon: <LayersIcon />,
		menuClassName: "w-60 p-3",
		menu: <SystemChips systems={systems} />,
	};
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
 * aliases, what it is, and the globs it is made of.
 */
export function SystemChip({ system }: { system: NamedSystem }): JSX.Element {
	const aliases = system.aliases ?? [];
	return (
		<Popover>
			<PopoverTrigger
				onClick={(event) => event.stopPropagation()}
				className={`${CHIP} cursor-pointer hover:bg-muted`}
			>
				<ChipFace name={system.name} />
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
				{system.description !== undefined && (
					<p className="text-sm">{system.description}</p>
				)}
				<Globs system={system} className="pt-1" />
				{/* The address change is all it takes: the page follows it. */}
				<a
					href={`#systems/${encodeURIComponent(system.name)}`}
					className="pt-1 text-primary text-xs hover:underline"
				>
					Recent changes and todos
				</a>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The system called `name` as its chip, opening to its globs when `systems`,
 * the ones this project names, has it; otherwise, as for one another project
 * names or a name since dropped, the same chip opening to nothing.
 */
export function SystemNameChip({
	name,
	systems,
}: {
	name: string;
	systems: readonly NamedSystem[];
}): JSX.Element {
	const system = systems.find((each) => each.name === name);
	return system === undefined ? (
		<span className={CHIP}>
			<ChipFace name={name} />
		</span>
	) : (
		<SystemChip system={system} />
	);
}

const CHIP =
	"inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-1.5 align-middle font-mono text-foreground/90 text-xs";

/** What a system's chip shows: its color, then its name. */
export function ChipFace({ name }: { name: string }): JSX.Element {
	return (
		<>
			<span
				aria-hidden
				className="size-2 shrink-0 rounded-full"
				style={{ backgroundColor: dot(name) }}
			/>
			<span className="min-w-0 truncate">{name}</span>
		</>
	);
}

/** The globs `system` is made of, those it ignores faded after them with a `!`. */
export function Globs({
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
