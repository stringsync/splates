import { useReactive, useResource } from "core/react";
import { MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { type JSX, type RefObject, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { PlanMarkups } from "./plan-markups";

/** A note on a passage of a plan: the text it quotes, and what is said of it. */
export interface PlanComment {
	quote: string;
	note: string;
}

/** What the page's frame last said was selected, and where in the frame. */
export interface PlanSelection {
	text: string;
	rect: { x: number; y: number; w: number; h: number } | null;
}

/** The comments made on a plan, what the reply says of them, and how to change them. */
export function usePlanComments(): {
	comments: PlanComment[];
	markups: PlanMarkups;
	any: boolean;
	send: (
		send: (text: string, files?: readonly File[]) => Promise<void>,
		text: string,
		files: File[],
	) => Promise<void>;
	set: (next: PlanComment[]) => void;
	clear: () => void;
	text: string;
	/** `reply` with the comments' text after it. */
	joinedTo: (reply: string) => string;
} {
	const [comments, set] = useState<PlanComment[]>([]);
	const text = commentsText(comments);
	const markups = useResource(() => new PlanMarkups(), []);
	const marked = useReactive(markups, (each) => each.any, ["changed"]);
	return {
		comments,
		markups,
		any: text !== "" || marked,
		send: async (send, text, files) =>
			send(text, [...files, ...(await markups.files())]),
		set,
		clear: () => {
			set([]);
			markups.clear();
		},
		text,
		joinedTo: (reply) =>
			[reply, text].filter((each) => each !== "").join("\n\n"),
	};
}

/**
 * The text selected in a plan page's frame, and where, while `active`; the
 * second value forgets it. Call it beside the frame, and keep the comments
 * made from it in the sheet.
 */
export function usePlanSelection(
	frame: RefObject<HTMLIFrameElement | null>,
	active: boolean,
): [PlanSelection | null, () => void] {
	const [selection, setSelection] = useState<PlanSelection | null>(null);
	useEffect(() => {
		if (!active) {
			setSelection(null);
			return;
		}
		const heard = (event: MessageEvent) => {
			const data: unknown = event.data;
			if (
				event.source === null ||
				event.source !== frame.current?.contentWindow ||
				typeof data !== "object" ||
				data === null ||
				(data as { splates?: unknown }).splates !== "selection"
			) {
				return;
			}
			const { text, rect } = data as { text?: unknown; rect?: unknown };
			setSelection(
				typeof text === "string" && text !== ""
					? { text, rect: rectOf(rect) }
					: null,
			);
		};
		window.addEventListener("message", heard);
		return () => window.removeEventListener("message", heard);
	}, [frame, active]);
	return [selection, () => setSelection(null)];
}

/** The Comment button, over the frame at the selection it was reported at. */
export function CommentButton({
	selection,
	onComment,
}: {
	selection: PlanSelection;
	onComment: () => void;
}): JSX.Element {
	const rect = selection.rect;
	return (
		<Button
			size="sm"
			aria-label="comment on selection"
			// Keeps the selection in the page while it is pressed.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onComment}
			style={
				rect === null
					? undefined
					: {
							left: Math.max(4, rect.x + rect.w / 2 - 40),
							top: Math.max(4, rect.y - 40),
						}
			}
			className="absolute z-10 shadow-lg"
		>
			<MessageSquarePlusIcon data-icon="inline-start" />
			Comment
		</Button>
	);
}

/** The comments as an editable list, each led by the passage it quotes. */
export function CommentList({
	comments,
	onChange,
	className,
}: {
	comments: PlanComment[];
	onChange: (next: PlanComment[]) => void;
	className?: string;
}): JSX.Element {
	return (
		<section aria-label="comments" className={className}>
			<h2 className="px-0.5 font-medium text-white/60 text-xs uppercase tracking-wide">
				Comments · {comments.length}
			</h2>
			{comments.length === 0 && (
				<p className="px-0.5 text-sm text-white/50">
					Select text in the plan to comment on it.
				</p>
			)}
			<ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
				{comments.map((comment, at) => (
					<li
						// A comment is told apart by its place in the list.
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place
						key={at}
						className="flex flex-col gap-1 rounded-md bg-white/10 p-2"
					>
						<blockquote className="line-clamp-2 text-amber-200 text-xs">
							“{comment.quote}”
						</blockquote>
						<div className="flex items-start gap-1">
							<textarea
								aria-label={`comment ${at + 1}`}
								value={comment.note}
								rows={2}
								onChange={(event) =>
									onChange(
										comments.map((each, index) =>
											index === at
												? { ...each, note: event.target.value }
												: each,
										),
									)
								}
								className="min-w-0 flex-1 resize-none rounded bg-black/40 px-2 py-1 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-white/40"
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`remove comment ${at + 1}`}
								className="text-white hover:bg-white/15 hover:text-white"
								onClick={() =>
									onChange(comments.filter((_, index) => index !== at))
								}
							>
								<Trash2Icon />
							</Button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

/** What the reply says of `comments`: each with the text it quotes; "" with none. */
export function commentsText(comments: PlanComment[]): string {
	const said = comments.filter((each) => each.note.trim() !== "");
	if (said.length === 0) {
		return "";
	}
	return [
		"> **Comments on the plan**",
		...said.map(
			(each) =>
				`- On “${each.quote.replace(/\s+/g, " ")}”: ${each.note.trim().replace(/\n+/g, " ")}`,
		),
	].join("\n\n");
}

function rectOf(value: unknown): PlanSelection["rect"] {
	const box = value as Record<string, unknown> | null;
	if (box === null || typeof box !== "object") {
		return null;
	}
	const left = box.x;
	const top = box.y;
	const width = box.w;
	const height = box.h;
	return typeof left === "number" &&
		typeof top === "number" &&
		typeof width === "number" &&
		typeof height === "number"
		? { x: left, y: top, w: width, h: height }
		: null;
}
