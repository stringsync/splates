import type {
	AreaProgress,
	FieldProgress,
	StepProgress,
} from "@stringsync/splates-server/setup";
import {
	BotIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	Loader2Icon,
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
import { CredPrivacy } from "./cred-privacy";
import { Markdown } from "./markdown";

/** The agents' areas, which the index lists first, in this order. */
export const AGENT_JOURNEYS = ["opencode", "claude", "codex"];

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
 * its fields, then Next, which does what the step needs. Beside Next, "2 of
 * 4"; the last page's says Finish, and a failed one's Try again. The only
 * other ways out are a quiet link back to the index, one to hand the step
 * to an agent, and, once a step is done or started, the index's Undo, so a
 * journey left partway can be taken back out from where it stands.
 */
export function StepForm({
	title,
	why,
	warning,
	at,
	of,
	steps,
	onGo,
	next,
	onNext,
	onAgent,
	onLeave,
	undo,
	onUndo,
	children,
}: {
	title: string;
	why?: ReactNode;
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
	onLeave: () => void;
	/** The title of the journey's area, to undo, or null while it has nothing to undo. */
	undo: string | null;
	onUndo?: () => void;
	children?: ReactNode;
}): JSX.Element {
	const working = next.kind === "working";
	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex items-center justify-between gap-4">
				<Button
					variant="link"
					className="h-auto p-0 text-muted-foreground"
					onClick={onLeave}
				>
					<ChevronLeftIcon data-icon="inline-start" /> Setup
				</Button>
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
			{steps !== undefined && steps.length > 1 && (
				<StepList steps={steps} at={at - 1} working={working} onGo={onGo} />
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
					<h2 className="font-medium text-2xl">{title}</h2>
					{why !== undefined && <p className="text-muted-foreground">{why}</p>}
				</header>
				{warning !== undefined && (
					<Alert variant="warning">
						<TriangleAlertIcon aria-hidden />
						<AlertTitle>To put right</AlertTitle>
						<AlertDescription>{warning}</AlertDescription>
					</Alert>
				)}
				{children !== undefined && (
					<fieldset disabled={working} className="flex min-w-0 flex-col gap-6">
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
						<Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden />
						{next.doing ?? "Working on it…"}
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
						<span className="text-muted-foreground text-sm tabular-nums">
							{at} of {of}
						</span>
						<Button type="submit" className="min-w-24" disabled={working}>
							{working ? (
								<>
									<Loader2Icon className="animate-spin" /> Next
								</>
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
	);
}

/**
 * Every step of the journey in order, the page's among them marked, and the
 * ones before it done or not, so a journey opened partway shows what came first.
 */
function StepList({
	steps,
	at,
	working,
	onGo,
}: {
	steps: readonly StepProgress[];
	/** The page shown, from 0. */
	at: number;
	working: boolean;
	onGo?: (index: number) => void;
}): JSX.Element {
	return (
		<ol aria-label="steps" className="flex flex-col gap-1 text-sm">
			{steps.map((step, index) => {
				const here = index === at;
				const done = step.status === "done";
				const warned = step.warning !== null;
				const row = (
					<>
						<span
							className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${
								warned
									? "border-warning text-warning"
									: done
										? "border-success text-success"
										: here
											? "border-foreground bg-foreground text-background"
											: "text-muted-foreground"
							}`}
							aria-hidden
						>
							{warned ? (
								<TriangleAlertIcon className="size-3" />
							) : done ? (
								<CheckIcon className="size-3" />
							) : (
								index + 1
							)}
						</span>
						<span className={here ? "font-medium" : "text-muted-foreground"}>
							{step.title}
						</span>
					</>
				);
				return (
					<li key={step.id} aria-current={here ? "step" : undefined}>
						{onGo !== undefined && !here && index < at ? (
							<button
								type="button"
								disabled={working}
								className="flex cursor-pointer items-center gap-2 text-left hover:underline disabled:cursor-default"
								onClick={() => onGo(index)}
							>
								{row}
							</button>
						) : (
							<span className="flex items-center gap-2">{row}</span>
						)}
					</li>
				);
			})}
		</ol>
	);
}

/**
 * A field to paste a cred into, as part of a page's form: Next saves it to
 * the device's store, so the field has no Save of its own.
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
