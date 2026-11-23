import type { Steps } from "@splates/server/plans/browser";
import { CheckIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { ReplyContext } from "./card-reply";
import { doneFrom, type Finished } from "./steps-asked";

/**
 * The foot of a Steps card: Done tells the agent, once, that the person is
 * finished, checked off or not. With steps left unchecked it asks first, in
 * a strip in its place. Once told, it stays finished and sends nothing more.
 */
export function DoneBar({
	steps,
	done,
	finished,
	onSent,
}: {
	steps: Steps;
	/** How many steps are checked off. */
	done: number;
	/** The Done already sent for this version, read from the thread, or null. */
	finished: Finished | null;
	/** Called once Done is sent. */
	onSent?: () => void;
}): JSX.Element | null {
	const send = useContext(ReplyContext)?.send ?? null;
	const [asking, setAsking] = useState(false);
	const [sending, setSending] = useState(false);
	// What was sent from here, until the thread holds it.
	const [sent, setSent] = useState<Finished | null>(null);
	const count = steps.steps.length;
	const told = finished ?? sent;
	if (told !== null) {
		return (
			<Foot>
				<span className="min-w-0 flex-1 text-muted-foreground text-xs">
					The agent was told you finished, with {told.checked} of {told.count}{" "}
					checked off.
				</span>
				<span
					role="status"
					className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-success/30 bg-success/10 px-2.5 font-medium text-[0.8rem] text-success"
				>
					<CheckIcon className="size-3.5" />
					Done
				</span>
			</Foot>
		);
	}
	if (send === null) {
		return null;
	}
	const finish = () => {
		if (sending) {
			return;
		}
		setSending(true);
		void send(doneFrom(steps, done))
			.then(() => {
				setSent({ title: steps.title, checked: Math.min(done, count), count });
				onSent?.();
			})
			.finally(() => {
				setSending(false);
				setAsking(false);
			});
	};
	if (asking) {
		return (
			<Foot warn>
				<div className="min-w-0 flex-1 text-sm">
					<div className="font-medium">{unchecked(done, count)}</div>
					<div className="text-muted-foreground text-xs">
						Tell the agent you're done anyway?
					</div>
				</div>
				<Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
					Keep going
				</Button>
				<Button size="sm" disabled={sending} onClick={finish}>
					<CheckIcon />
					I'm done
				</Button>
			</Foot>
		);
	}
	return (
		<Foot>
			<span className="min-w-0 flex-1 text-muted-foreground text-xs">
				Finished? Tell the agent so it can check your work.
			</span>
			<Button
				size="sm"
				disabled={sending}
				onClick={() => (done >= count ? finish() : setAsking(true))}
			>
				<CheckIcon />
				Done
			</Button>
		</Foot>
	);
}

function Foot({
	warn = false,
	children,
}: {
	warn?: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<div
			className={
				warn
					? "flex items-center gap-2 border-t bg-warning/10 px-4 py-2.5 animate-in fade-in duration-200"
					: "flex items-center gap-2 border-t bg-muted/40 px-4 py-2"
			}
		>
			{children}
		</div>
	);
}

/** Which steps are left unchecked, said in a line. */
export function unchecked(done: number, count: number): string {
	if (done === 0) {
		return count === 1
			? "The step isn't checked off."
			: `None of the ${count} steps are checked off.`;
	}
	return count - done === 1
		? `Step ${count} isn't checked off.`
		: `Steps ${done + 1} to ${count} aren't checked off.`;
}
