import type { AreaProgress } from "@stringsync/splates-server/setup";
import {
	BotIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	Loader2Icon,
	RotateCwIcon,
	Undo2Icon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { CredPrivacy } from "./cred-privacy";

/** The agents' areas, which the index lists first, in this order. */
export const AGENT_JOURNEYS = ["opencode", "claude", "codex"];

/**
 * The setup index: a plain row per area, "Set up OpenCode" and the like,
 * the agents first, and a green check on each one whose steps are all done.
 * A done row still opens, to review or redo it.
 */
export function SetupIndex({
	areas,
	onSelect,
	onUndo,
}: {
	areas: readonly AreaProgress[];
	onSelect: (id: string) => void;
	/** Asks to undo an area with a step done. */
	onUndo: (id: string) => void;
}): JSX.Element {
	return (
		<nav
			aria-label="setup areas"
			className="mx-auto flex w-full max-w-lg flex-col gap-6"
		>
			{ordered(areas).map((group) => (
				<ul
					key={group[0]?.id}
					className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card"
				>
					{group.map((area) => {
						const done = area.done === area.steps.length;
						return (
							<li key={area.id} className="flex items-center">
								<button
									type="button"
									className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
									onClick={() => onSelect(area.id)}
								>
									<span className="flex-1">Set up {area.title}</span>
									{done ? (
										<span className="flex items-center gap-1.5 text-sm text-success">
											<CheckIcon className="size-4" aria-hidden /> Done
										</span>
									) : (
										<ChevronRightIcon
											className="size-4 text-muted-foreground"
											aria-hidden
										/>
									)}
								</button>
								{area.done > 0 && (
									<Button
										variant="ghost"
										size="sm"
										className="mr-2 text-muted-foreground"
										aria-label={`Undo ${area.title}`}
										onClick={() => onUndo(area.id)}
									>
										<Undo2Icon aria-hidden /> Undo
									</Button>
								)}
							</li>
						);
					})}
				</ul>
			))}
		</nav>
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
 * other ways out are a quiet link back to the index and one to hand the step
 * to an agent.
 */
export function StepForm({
	title,
	why,
	at,
	of,
	next,
	onNext,
	onAgent,
	onLeave,
	children,
}: {
	title: string;
	why?: ReactNode;
	/** This page's place in the journey, from 1. */
	at: number;
	of: number;
	next: NextState;
	/** Presses Next, with the form its fields are read from. */
	onNext: (form: HTMLFormElement) => void;
	/** Starts a conversation on the step; null when no agent can be started. */
	onAgent: (() => void) | null;
	onLeave: () => void;
	children?: ReactNode;
}): JSX.Element {
	const working = next.kind === "working";
	return (
		<div className="mx-auto flex w-full max-w-lg flex-col gap-6">
			<Button
				variant="link"
				className="h-auto self-start p-0 text-muted-foreground"
				onClick={onLeave}
			>
				<ChevronLeftIcon data-icon="inline-start" /> Setup
			</Button>
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
				{next.kind === "working" && next.doing !== undefined && (
					<p role="status" className="text-muted-foreground text-sm">
						{next.doing}
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
		<div className="mx-auto flex w-full max-w-lg flex-col gap-6">
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
