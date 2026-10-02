import { OctagonPauseIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { Sheet } from "#dev/components/ui/sheet.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import type { Blocker } from "../blocked";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import { approve, defer, reply, skip } from "./api";
import { Composer } from "./compose";
import { ItemSheet, plain } from "./question";

/** A question by name, rather than the object, so it keeps up with the plan. */
interface Named {
	task: string;
	number: string;
}

/**
 * What waits on you: every question escalated tasks ask under `## Blocked`
 * that nobody has answered, grouped by task. Once answered it is its agent's,
 * and a task still at work asks in its chat.
 */
export function Blocked({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	return (
		<Questions
			snapshot={snapshot}
			shown={snapshot.blocked}
			empty={
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<OctagonPauseIcon />
						</EmptyMedia>
						<EmptyTitle>Nothing needs you</EmptyTitle>
						<EmptyDescription>
							Questions agents escalate show up here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			}
		/>
	);
}

/**
 * Questions grouped by task, one line each, a task only when it has some. Each
 * opens in a sheet to act on it, where View opens its task, and J opens the
 * next one.
 */
function Questions({
	snapshot,
	shown,
	empty,
}: {
	snapshot: Snapshot;
	shown: Blocker[];
	empty: ReactNode;
}): JSX.Element {
	const [opened, setOpened] = useState<Named | null>(null);
	const keyboard = useKeyboard();

	// In the order listed, so J walks down the page.
	const listed = [...group(shown).values()].flat();
	useEffect(() => {
		const pressed = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() !== "j" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				typing(event.target) ||
				// A task open over the question: J there is not about the list.
				document.querySelectorAll('[role="dialog"]').length > 1
			) {
				return;
			}
			const at =
				opened === null
					? -1
					: listed.findIndex(
							(question) =>
								question.task === opened.task &&
								question.number === opened.number,
						);
			const next = listed[at + 1] ?? listed[0];
			if (next !== undefined) {
				event.preventDefault();
				setOpened({ task: next.task, number: next.number });
			}
		};
		addEventListener("keydown", pressed);
		return () => removeEventListener("keydown", pressed);
	}, [opened, listed]);

	// Only among `shown`: a question its task stops asking takes its sheet
	// with it.
	const current =
		opened === null
			? undefined
			: shown.find(
					(question) =>
						question.task === opened.task && question.number === opened.number,
				);

	return (
		<>
			{shown.length === 0 ? (
				empty
			) : (
				<div className="flex flex-col gap-6">
					{[...group(shown)].map(([task, asked]) => (
						<section
							key={task}
							aria-label={task}
							className="flex flex-col gap-1"
						>
							<h2 className="truncate text-muted-foreground text-xs">{task}</h2>
							{asked.map((question) => (
								<Row
									key={question.number}
									question={question}
									onOpen={() =>
										setOpened({ task: question.task, number: question.number })
									}
								/>
							))}
						</section>
					))}
					{keyboard && (
						<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<Kbd>J</Kbd> opens the next question
						</p>
					)}
				</div>
			)}
			<Sheet
				open={current !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{current && (
					<ItemSheet
						task={current.task}
						id={current.number}
						details={find(snapshot.tasks, current.task)}
						title={current.text}
						body={current.body}
					>
						<Respond
							question={current}
							review={find(snapshot.tasks, current.task)?.review ?? null}
							onDone={() => setOpened(null)}
						/>
					</ItemSheet>
				)}
			</Sheet>
		</>
	);
}

/** One question on one line: its number, its subject, and where it stands. */
function Row({
	question,
	onOpen,
}: {
	question: Blocker;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
		>
			<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
				{question.number}
			</span>
			<span className="min-w-0 flex-1 truncate text-sm">
				{plain(question.text)}
			</span>
		</button>
	);
}

/**
 * What can be done about a question from its sheet: answer, defer or skip
 * it, or approve one asking to merge.
 */
function Respond({
	question,
	review,
	onDone,
}: {
	question: Blocker;
	/** The task's review question, if it is asking for one. */
	review: string | null;
	onDone: () => void;
}): JSX.Element {
	const { task, number } = question;
	const reviewing = review === number;
	const offers = question.choices.length > 0;
	return (
		<div className="flex flex-col gap-3">
			<Composer
				task={task}
				question={question}
				label={reviewing ? "Request changes" : "Send"}
				placeholder={
					reviewing
						? "What needs changing, @ for a file"
						: offers
							? "Add context (optional), @ for a file"
							: "Reply, @ for a file"
				}
				send={(composed) => reply({ task, question: number, ...composed })}
				onDone={onDone}
			/>
			<div className="flex gap-2">
				{reviewing ? (
					<Action
						label="Approve"
						run={() => approve(task, number)}
						done={onDone}
					/>
				) : (
					<>
						<Action
							label="Defer"
							run={() => defer(task, number)}
							done={onDone}
						/>
						<Action label="Skip" run={() => skip(task, number)} done={onDone} />
					</>
				)}
			</div>
		</div>
	);
}

/** One tap that answers a question for you. */
function Action({
	label,
	run,
	done,
}: {
	label: string;
	run: () => Promise<void>;
	done: () => void;
}): JSX.Element {
	const [sending, setSending] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			disabled={sending}
			onClick={() => {
				setSending(true);
				run().then(done, (error: unknown) => {
					setSending(false);
					toast.add({
						title: `${label} failed`,
						description: error instanceof Error ? error.message : String(error),
						type: "error",
					});
				});
			}}
		>
			{label}
		</Button>
	);
}

function find(tasks: Details[], name: string): Details | undefined {
	return tasks.find((task) => task.task === name);
}

/** Where a keypress is text being written, not a shortcut. */
function typing(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.closest("input, textarea, select, [role=combobox]") !== null)
	);
}

/**
 * Whether this looks like a computer, going by a mouse or trackpad: no page
 * can see a keyboard until it is typed on, and a phone's has no J to spare.
 */
function useKeyboard(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(KEYBOARD);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(KEYBOARD).matches,
	);
}

const KEYBOARD = "(hover: hover) and (pointer: fine)";

/** Questions by task, in the order the snapshot lists them. */
function group(questions: Blocker[]): Map<string, Blocker[]> {
	const byTask = new Map<string, Blocker[]>();
	for (const question of questions) {
		byTask.set(question.task, [...(byTask.get(question.task) ?? []), question]);
	}
	return byTask;
}
