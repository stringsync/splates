import { CopyIcon, LightbulbIcon, SendHorizontalIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import { assumptions } from "../plan";
import {
	AssumptionList,
	AssumptionsChanged,
	ChallengeCard,
	useChallenges,
} from "./assumption-list";
import { copiedLabel, useCopy } from "./card";
import type { Reply } from "./card-reply";
import { Refusal, useRefusal } from "./refusal";

/**
 * What a task has assumed so far, read from its `ARBOR.md` as it changes, as
 * a card beside its work: a challenge costs least before more is built on the
 * choice. The card lists them; a click opens them all in a dialog, each as a
 * question card, to challenge at once. Challenges go to its agent as a
 * message of their own, quoting each line as the review card does, or are
 * copied for an agent the page cannot message, and kept until each is
 * withdrawn. Nothing shows until the task assumes something.
 */
export function AssumptionsCard({
	task,
	plan,
	reply,
}: {
	task: string;
	/** Its `ARBOR.md`; null without one. */
	plan: string | null;
	/** What it answers through; null where nothing can be sent or kept. */
	reply: Reply | null;
}): JSX.Element | null {
	const name = `assumptions:${task}`;
	const {
		assumptions: assumed,
		answers,
		challenge,
		reply: said,
		clear,
		changed,
		dropped,
		reload,
	} = useChallenges(assumptions(plan ?? ""), {
		read: () => reply?.drafts.read(name) ?? "",
		write: (text) => reply?.drafts.write(name, text),
	});
	// The assumption the dialog opened at; null while it is shut.
	const [at, setAt] = useState<string | null>(null);
	const { refusal, attempt } = useRefusal();
	const { copied, copy } = useCopy();
	const list = useRef<HTMLOListElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only as the dialog opens
	useEffect(() => {
		if (at === null) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			const card = list.current?.querySelector<HTMLElement>(
				`[aria-label="question ${CSS.escape(at)}"]`,
			);
			card?.scrollIntoView({ block: "nearest" });
			card?.querySelector<HTMLElement>("[data-stop]")?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [at !== null]);
	if (assumed.length === 0) {
		return null;
	}
	const send = reply?.send ?? null;
	const submit = () => {
		if (said === "") {
			return;
		}
		if (send === null) {
			// Kept, to copy again until its agent records it, as copied answers are.
			copy(said);
		} else {
			void attempt(
				send(said).then(() => {
					clear();
					setAt(null);
				}),
				"Not sent",
			);
		}
	};
	const sendButton = (
		<Button ref={button} size="sm" disabled={said === ""} onClick={submit}>
			{send === null ? (
				<>
					<CopyIcon data-icon="inline-start" />
					{copiedLabel(copied, "Copy challenges")}
				</>
			) : (
				<>
					<SendHorizontalIcon data-icon="inline-start" />
					Send challenges
				</>
			)}
		</Button>
	);
	// Enter in a card moves on to the next, then to the button that sends.
	const next = (number: string) => {
		const cards = [
			...(list.current?.querySelectorAll<HTMLElement>("li[aria-label]") ?? []),
		];
		const after =
			cards[
				cards.findIndex(
					(card) => card.getAttribute("aria-label") === `question ${number}`,
				) + 1
			];
		const stop = after?.querySelector<HTMLElement>("[data-stop]");
		if (stop) {
			stop.focus();
		} else {
			button.current?.focus();
		}
	};
	return (
		<section
			aria-label="assumptions"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<LightbulbIcon />
				Assumptions
			</h3>
			<AssumptionList
				assumptions={assumed}
				answers={answers}
				live
				heading={false}
				onAnswer={challenge}
				onNext={() => {}}
				onChallenge={setAt}
			/>
			{said !== "" && at === null && (
				<footer className="flex flex-col items-end gap-1.5 border-t px-3 pt-2 pb-1">
					{changed && (
						<AssumptionsChanged
							dropped={dropped}
							onReload={reload}
							className="w-full"
						/>
					)}
					{sendButton}
					<Refusal refusal={refusal} className="text-right" />
				</footer>
			)}
			<Dialog
				open={at !== null}
				onOpenChange={(open) => {
					if (!open) {
						setAt(null);
					}
				}}
			>
				<DialogContent className="flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-xl">
					<DialogHeader className="px-4 pt-4 pb-3">
						<DialogTitle>Assumptions in {task}</DialogTitle>
						<DialogDescription>
							Pick another choice to challenge one. The assumed one leaves it as
							it is.
						</DialogDescription>
					</DialogHeader>
					<ol
						ref={list}
						aria-label="assumptions to challenge"
						className="min-h-0 flex-1 overflow-y-auto border-t"
					>
						{assumed.map((each, index) => (
							<ChallengeCard
								key={each.number}
								assumed={each}
								answer={answers[index] ?? null}
								live
								onAnswer={(answer) => challenge(each, answer)}
								onNext={() => next(each.number)}
							/>
						))}
					</ol>
					<DialogFooter className="m-0 items-center px-4 py-3">
						{changed ? (
							<AssumptionsChanged
								dropped={dropped}
								onReload={reload}
								className="flex-1"
							/>
						) : (
							<Refusal refusal={refusal} className="flex-1" />
						)}
						{sendButton}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
