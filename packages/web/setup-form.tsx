import type {
	AreaProgress,
	FieldProgress,
	StepProgress,
} from "@stringsync/splates-server/setup";
import {
	BotIcon,
	CheckIcon,
	ChevronRightIcon,
	InfoIcon,
	RotateCwIcon,
	TriangleAlertIcon,
	Undo2Icon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#web/components/ui/alert.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { StillWaiting } from "./countdown";
import { CredPrivacy } from "./cred-privacy";
import { Markdown } from "./markdown";
import { SETUP_WORK } from "./setup-api";
import { StepBar, StepRail } from "./setup-step-nav";

/** The agents' areas, which the index lists first, in this order. */
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
}: {
	areas: readonly AreaProgress[];
	onSelect: (id: string) => void;
	/** Asks to undo an area with a step done or started. */
	onUndo: (id: string) => void;
}): JSX.Element {
	return (
		<nav aria-label="setup areas" className="flex w-full flex-col gap-6">
			{ordered(areas).map((group) => (
				<ul
					key={group[0]?.id}
					className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
				>
					{group.map((area) => (
						<AreaRow
							key={area.id}
							area={area}
							onSelect={onSelect}
							onUndo={onUndo}
						/>
					))}
				</ul>
			))}
		</nav>
	);
}

/** How far an area is, as a line under its name. */
function progressLine(area: AreaProgress): string {
	const warned = area.steps.filter((step) => step.warning !== null).length;
	const line = doneLine(area);
	return warned === 0 ? line : `${line}, ${warned} to put right`;
}

function doneLine(area: AreaProgress): string {
	if (area.done === area.steps.length) {
		return "All steps done";
	}
	if (area.done === 0 && !area.undoable) {
		return `${area.steps.length} steps`;
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
	onUndo: (id: string) => void;
}): JSX.Element {
	const warned = area.steps.some((step) => step.warning !== null);
	const done = area.done === area.steps.length && !warned;
	return (
		<li className="flex min-h-16 items-center gap-2 pr-3 hover:bg-muted/50">
			<button
				type="button"
				aria-label={`Set up ${area.title}`}
				className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 pl-4 text-left outline-none focus-visible:bg-muted/50"
				onClick={() => onSelect(area.id)}
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="font-medium">Set up {area.title}</span>
					<span className="flex items-center gap-1.5 text-sm text-muted-foreground">
						{done && (
							<CheckIcon className="size-3.5 text-success" aria-hidden />
						)}
						{warned && (
							<TriangleAlertIcon
								className="size-3.5 text-warning"
								aria-hidden
							/>
						)}
						{progressLine(area)}
					</span>
				</span>
			</button>
			{area.undoable && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground"
					aria-label={`Undo ${area.title}`}
					onClick={() => onUndo(area.id)}
				>
					<Undo2Icon aria-hidden /> Undo
				</Button>
			)}
			<ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
		</li>
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

/** Where a page's Next stands: ready, doing what the step needs, or failed. */
export type NextState =
	| { kind: "ready" }
	/** `doing` is a line on what runs, as "Installing OpenCode…". */
	| { kind: "working"; doing?: string }
	/** `problem` is one line on what went wrong, shown under the fields. */
	| { kind: "failed"; problem: string };

/**
 * One page of a journey, as a plain web form: the question, one line on why,
 * its fields, then Next, which does what the step needs. The journey's steps
 * run down a rail beside the page on a wide screen, and as a bar over its
 * title on a phone. The last page's Next says Finish, and a failed one's Try
 * again. The only
 * other ways out are a quiet link back to the index, one to hand the step
 * to an agent, and, once a step is done or started, the index's Undo, so a
 * journey left partway can be taken back out from where it stands.
 */
export function StepForm({
	title,
	why,
	detail,
	warning,
	at,
	of,
	steps,
	onGo,
	next,
	onNext,
	onAgent,
	undo,
	onUndo,
	children,
}: {
	title: string;
	why?: ReactNode;
	/** What stands on the step now, as what the box will cost, in a box of its own under `why`. */
	detail?: ReactNode;
	/** What wants putting right on the step, and how, shown above its fields. */
	warning?: ReactNode;
	/** This page's place in the journey, from 1. */
	at: number;
	of: number;
	/** Every step of the journey, listed above the page so none is out of sight. */
	steps?: readonly StepProgress[];
	/** Goes back to the step at this index, from 0. */
	onGo?: (index: number) => void;
	next: NextState;
	/** Presses Next, with the form its fields are read from. */
	onNext: (form: HTMLFormElement) => void;
	/** Starts a conversation on the step; null when no agent can be started. */
	onAgent: (() => void) | null;
	/** The title of the journey's area, to undo, or null while it has nothing to undo. */
	undo: string | null;
	onUndo?: () => void;
	children?: ReactNode;
}): JSX.Element {
	const working = next.kind === "working";
	const progress = steps !== undefined && steps.length > 1;
	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex items-center justify-end gap-4">
				{undo !== null && (
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						aria-label={`Undo ${undo}`}
						disabled={working}
						onClick={onUndo}
					>
						<Undo2Icon aria-hidden /> Undo
					</Button>
				)}
			</div>
			<div
				className={
					progress
						? "grid gap-10 md:grid-cols-[13rem_minmax(0,1fr)]"
						: "contents"
				}
			>
				{progress && (
					<StepRail steps={steps} at={at - 1} working={working} onGo={onGo} />
				)}
				<form
					aria-label={title}
					className="flex flex-col gap-8"
					onSubmit={(event) => {
						event.preventDefault();
						if (!working) {
							onNext(event.currentTarget);
						}
					}}
				>
					<header className="flex flex-col gap-2">
						{progress && (
							<StepBar
								steps={steps}
								at={at - 1}
								working={working}
								onGo={onGo}
								className="mb-2 md:hidden"
							/>
						)}
						<h2 className="font-medium text-2xl">{title}</h2>
						{why !== undefined && (
							<p className="text-muted-foreground">{why}</p>
						)}
					</header>
					{detail !== undefined && (
						<Alert>
							<InfoIcon aria-hidden />
							<AlertDescription>{detail}</AlertDescription>
						</Alert>
					)}
					{warning !== undefined && (
						<Alert variant="warning">
							<TriangleAlertIcon aria-hidden />
							<AlertTitle>To put right</AlertTitle>
							<AlertDescription>{warning}</AlertDescription>
						</Alert>
					)}
					{children !== undefined && (
						<fieldset
							disabled={working}
							className="flex min-w-0 flex-col gap-6"
						>
							{children}
						</fieldset>
					)}
					{next.kind === "failed" && (
						<p role="alert" className="text-destructive text-sm">
							{next.problem}
						</p>
					)}
					{next.kind === "working" && (
						<p
							role="status"
							className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
						>
							{next.doing ?? "Working on it…"}
							<StillWaiting
								within={SETUP_WORK}
								doing="working"
								className="ml-auto"
							/>
						</p>
					)}
					<footer className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t pt-6">
						{onAgent !== null && (
							<Button
								type="button"
								variant="link"
								className="h-auto gap-1.5 p-0 text-muted-foreground"
								onClick={onAgent}
							>
								<BotIcon /> Set it up with an agent
							</Button>
						)}
						{/* Together, so on a phone they wrap under the link as one. */}
						<span className="ml-auto flex items-center gap-4">
							{!progress && (
								<span className="text-muted-foreground text-sm tabular-nums">
									{at} of {of}
								</span>
							)}
							<Button type="submit" className="min-w-24" disabled={working}>
								{working ? (
									"Working…"
								) : next.kind === "failed" ? (
									<>
										<RotateCwIcon /> Try again
									</>
								) : at === of ? (
									"Finish"
								) : (
									"Next"
								)}
							</Button>
						</span>
					</footer>
				</form>
			</div>
		</div>
	);
}

/**
 * A field for the person to paste a cred into. Put it inside a page's form,
 * whose Next saves the cred, since the field has no Save button.
 */
export function CredField({
	name,
	label,
	help,
	saved = false,
}: {
	/** The cred's environment-variable name, as `OPENCODE_GO_API_KEY`. */
	name: string;
	label: string;
	/** Where to get it, as a line under the field. */
	help?: ReactNode;
	/** Whether the store keeps it already, so the field offers to replace it. */
	saved?: boolean;
}): JSX.Element {
	return (
		<Field>
			<FieldLabel htmlFor={name}>{label}</FieldLabel>
			<Input
				id={name}
				name={name}
				type="password"
				autoComplete="off"
				placeholder={
					saved ? "Saved. Paste again to replace it" : "Paste it here"
				}
				className="font-mono max-md:placeholder:font-sans"
			/>
			{help !== undefined && <FieldDescription>{help}</FieldDescription>}
			<CredPrivacy />
		</Field>
	);
}

/** Past a journey's last page: it is set up, and what to do with it. */
export function JourneyDone({
	title,
	onLeave,
	onUndo,
	children,
}: {
	title: string;
	onLeave: () => void;
	/** Asks to undo it. */
	onUndo: () => void;
	/** What to do next, as "Start an OpenCode conversation". */
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex w-full flex-col gap-6">
			<h2 className="flex items-center gap-3 font-medium text-2xl">
				<CheckIcon className="size-6 text-success" aria-hidden />
				{title} is set up
			</h2>
			<div className="flex flex-wrap items-center gap-3">
				{children}
				<Button variant="outline" onClick={onLeave}>
					Back to setup
				</Button>
				<Button
					variant="ghost"
					className="text-muted-foreground"
					onClick={onUndo}
				>
					<Undo2Icon data-icon="inline-start" /> Undo {title}
				</Button>
			</div>
		</div>
	);
}

/** One field a step's shape asks, as the page's form sends it. */
export function StepField({ field }: { field: FieldProgress }): JSX.Element {
	switch (field.kind) {
		case "cred":
			return (
				<CredField
					name={field.name}
					label={field.label}
					help={
						field.help === null ? undefined : (
							<Markdown text={field.help} inline />
						)
					}
					saved={field.saved}
				/>
			);
		case "text":
			return (
				<Field>
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
					<Input
						id={field.name}
						name={field.name}
						placeholder={field.placeholder ?? undefined}
						defaultValue={field.value ?? undefined}
					/>
				</Field>
			);
		case "choice":
			return (
				<Field>
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
					<NativeSelect id={field.name} name={field.name}>
						{field.options.map((option) => (
							<NativeSelectOption key={option.value} value={option.value}>
								{option.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			);
		case "yes-no":
			return (
				<Field orientation="horizontal">
					<Switch id={field.name} name={field.name} />
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
				</Field>
			);
	}
}
