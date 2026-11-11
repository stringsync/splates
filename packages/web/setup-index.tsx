import type { AreaProgress } from "@splates/server/setup";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	TriangleAlertIcon,
	Undo2Icon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";

/** The ids of the agents' areas, which the setup index lists first. */
export const AGENT_JOURNEYS = ["opencode", "claude", "codex", "kimi"];

/**
 * The setup index: a plain row per area, "Set up OpenCode" and the like,
 * the agents first, and a green check on each one whose steps are all done,
 * or a warning while one has something to put right. A done row still
 * opens, to review or redo it.
 */
export function SetupIndex({
	areas,
	onSelect,
	onUndo,
	heading,
}: {
	areas: readonly AreaProgress[];
	onSelect: (id: string) => void;
	/** Lists the areas as one group under this heading, in the order given. */
	heading?: string;
	/** Asks to undo an area with a step done or started; none hides Undo. */
	onUndo?: (id: string) => void;
}): JSX.Element {
	return (
		<nav
			aria-label="setup areas"
			className="mx-auto flex w-full max-w-2xl flex-col gap-10"
		>
			{(heading === undefined ? ordered(areas) : [[...areas]]).map(
				(group, at) => (
					<div key={group[0]?.id} className="flex flex-col gap-2">
						<h2 className="px-3 font-medium text-muted-foreground text-sm">
							{heading ??
								(at === 0 && group[0] && AGENT_JOURNEYS.includes(group[0].id)
									? "Run agents"
									: "Set up more")}
						</h2>
						<ul className="flex flex-col gap-0.5">
							{group.map((area) => (
								<AreaRow
									key={area.id}
									area={area}
									onSelect={onSelect}
									onUndo={onUndo}
								/>
							))}
						</ul>
					</div>
				),
			)}
		</nav>
	);
}

/** How far an area is, as a line under its name. */
function progressLine(area: AreaProgress): string {
	const warned = area.steps.filter((step) => step.warning !== null).length;
	const line = doneLine(area);
	const extras =
		area.extras === 0
			? line
			: `${line}, ${area.extras} optional ${area.extras === 1 ? "step" : "steps"}`;
	return warned === 0 ? extras : `${extras}, ${warned} to put right`;
}

function doneLine(area: AreaProgress): string {
	if (area.complete) {
		return area.done === area.steps.length ? "All steps done" : "Set up";
	}
	if (area.done === 0 && !area.undoable) {
		return area.steps.length === 1 ? "1 step" : `${area.steps.length} steps`;
	}
	return `${area.done} of ${area.steps.length} steps done`;
}

function AreaRow({
	area,
	onSelect,
	onUndo,
}: {
	area: AreaProgress;
	onSelect: (id: string) => void;
	onUndo?: (id: string) => void;
}): JSX.Element {
	const warned = area.steps.some((step) => step.warning !== null);
	const done = area.complete && !warned;
	return (
		<li className="group flex items-center gap-1 rounded-lg pr-2 hover:bg-muted/60 has-[:focus-visible]:bg-muted/60">
			<button
				type="button"
				aria-label={`Set up ${area.title}`}
				className="flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-lg px-3 py-3.5 text-left outline-none"
				onClick={() => onSelect(area.id)}
			>
				<AreaMark done={done} warned={warned} started={area.done > 0} />
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="font-medium leading-5">
						Set up {area.title}
						{area.optional && (
							<span className="ml-2 font-normal text-muted-foreground text-xs">
								Optional
							</span>
						)}
					</span>
					<span className="text-muted-foreground text-sm leading-5">
						{area.purpose}
					</span>
					<span className="text-muted-foreground text-xs">
						{progressLine(area)}
					</span>
				</span>
			</button>
			{area.undoable && onUndo && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:group-hover:opacity-100"
					aria-label={`Undo ${area.title}`}
					onClick={() => onUndo(area.id)}
				>
					<Undo2Icon aria-hidden /> Undo
				</Button>
			)}
			<ChevronRightIcon
				className="size-4 shrink-0 text-muted-foreground/60"
				aria-hidden
			/>
		</li>
	);
}

/** The mark before an area: a check when done, a warning, a half circle once started, else an empty circle. */
function AreaMark({
	done,
	warned,
	started,
}: {
	done: boolean;
	warned: boolean;
	started: boolean;
}): JSX.Element {
	const className = "mt-0.5 size-5 shrink-0";
	if (warned) {
		return (
			<TriangleAlertIcon className={`${className} text-warning`} aria-hidden />
		);
	}
	if (done) {
		return (
			<CircleCheckIcon className={`${className} text-success`} aria-hidden />
		);
	}
	return started ? (
		<CircleDotIcon className={`${className} text-foreground/70`} aria-hidden />
	) : (
		<CircleIcon
			className={`${className} text-muted-foreground/40`}
			aria-hidden
		/>
	);
}

/** The areas in the order the index lists them: the agents, then the rest. */
function ordered(areas: readonly AreaProgress[]): AreaProgress[][] {
	const agents = AGENT_JOURNEYS.flatMap((id) =>
		areas.filter((area) => area.id === id),
	);
	const other = areas.filter((area) => !AGENT_JOURNEYS.includes(area.id));
	return [agents, other].filter((group) => group.length > 0);
}
