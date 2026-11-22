import { type JSX, useEffect, useRef, useState } from "react";
import { BeforeAfter, type CardRecord } from "./before-after";
import {
	CommentButton,
	CommentList,
	type PlanComment,
	type PlanSelection,
} from "./plan-comments";

/**
 * A plan told as text, its task's Before and After, laid out as a plan's
 * page is: Comment on a selected passage, the comments listed beside it.
 */
export function PlanText({
	record,
	comments,
	onComments,
}: {
	record: CardRecord;
	comments: PlanComment[];
	onComments: (next: PlanComment[]) => void;
}): JSX.Element {
	const pane = useRef<HTMLDivElement>(null);
	const [selection, setSelection] = useState<PlanSelection | null>(null);
	useEffect(() => {
		const select = () => {
			const chosen = window.getSelection();
			const text = chosen?.toString().trim() ?? "";
			const within = pane.current;
			if (
				chosen === null ||
				chosen.rangeCount === 0 ||
				text === "" ||
				!within
			) {
				setSelection(null);
				return;
			}
			const range = chosen.getRangeAt(0);
			if (!within.contains(range.commonAncestorContainer)) {
				setSelection(null);
				return;
			}
			const at = range.getBoundingClientRect();
			const box = within.getBoundingClientRect();
			setSelection({
				text,
				rect: {
					x: at.left - box.left,
					y: at.top - box.top,
					w: at.width,
					h: at.height,
				},
			});
		};
		document.addEventListener("selectionchange", select);
		return () => document.removeEventListener("selectionchange", select);
	}, []);
	return (
		<div className="relative flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 md:flex-row">
			<div className="relative min-h-0 flex-1">
				<div
					ref={pane}
					className="size-full overflow-y-auto rounded-md bg-card p-5 text-card-foreground"
				>
					<BeforeAfter record={record} />
				</div>
				{selection !== null && (
					<CommentButton
						selection={selection}
						onComment={() => {
							onComments([...comments, { quote: selection.text, note: "" }]);
							setSelection(null);
						}}
					/>
				)}
			</div>
			<CommentList
				comments={comments}
				onChange={onComments}
				className="flex max-h-40 shrink-0 flex-col gap-1.5 md:max-h-none md:w-64"
			/>
		</div>
	);
}
