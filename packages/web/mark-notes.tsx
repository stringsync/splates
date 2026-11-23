import { useReactive } from "core/react";
import { Trash2Icon } from "lucide-react";
import { type JSX, useEffect, useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { cn } from "#web/lib/utils.ts";
import type { Annotation } from "./annotation";

/**
 * The notes on the marks as a list, one row a mark led by its number: the
 * text the marks become. A picked mark's row is the one being written.
 */
export function MarkList({
	annotation,
	className,
}: {
	annotation: Annotation;
	className?: string;
}): JSX.Element {
	const { marks, selected } = useReactive(
		annotation,
		(each) => ({ marks: each.marks, selected: each.selected }),
		["changed"],
	);
	return (
		<section
			aria-label="marks"
			className={cn("flex min-h-0 flex-col gap-1.5", className)}
		>
			<h2 className="px-0.5 font-medium text-white/60 text-xs uppercase tracking-wide">
				Marks · {marks.length}
			</h2>
			{marks.length === 0 && (
				// Says where notes will go before the first mark is drawn.
				<p className="px-0.5 text-sm text-white/50">
					Notes on what you draw go here.
				</p>
			)}
			<ul className="flex min-h-0 flex-col gap-2 overflow-y-auto empty:hidden">
				{marks.map((mark, at) => (
					<MarkRow
						// A mark is told apart by where it was drawn.
						key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
						annotation={annotation}
						at={at}
						picked={at === selected}
					/>
				))}
			</ul>
		</section>
	);
}

/** Mark `at`'s note being written, led by its number. */
function MarkRow({
	annotation,
	at,
	picked,
}: {
	annotation: Annotation;
	at: number;
	picked: boolean;
}): JSX.Element {
	const touch = useTouch();
	const row = useRef<HTMLLIElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const note = useReactive(annotation, (each) => each.marks[at]?.note ?? "", [
		"changed",
	]);
	// A mark just drawn or picked on the image is there to be written about,
	// though a finger taps to, keeping the keyboard down until then.
	useEffect(() => {
		if (!picked) {
			return;
		}
		row.current?.scrollIntoView?.({ block: "nearest" });
		if (!touch) {
			field.current?.focus();
		}
	}, [picked, touch]);
	return (
		<li
			ref={row}
			className={cn(
				"flex shrink-0 cursor-text items-start gap-2 rounded-2xl border bg-[#1c1c1f] p-2 shadow-xl transition-[border-color,background-color]",
				picked
					? "border-[#ff1f8f]/60"
					: "border-white/10 focus-within:border-white/25",
			)}
			onPointerDown={(event) => {
				// Padding around the text is the box too: a press there writes.
				if (event.target === event.currentTarget) {
					event.preventDefault();
					field.current?.focus();
				}
			}}
		>
			<span
				className={cn(
					"mt-1 flex size-6 shrink-0 items-center justify-center rounded-full font-bold text-white text-xs",
					picked ? "bg-[#ff1f8f]" : "bg-white/15",
				)}
			>
				{at + 1}
			</span>
			<textarea
				ref={field}
				rows={1}
				aria-label={`note on mark ${at + 1}`}
				placeholder="What about it?"
				value={note}
				onFocus={() => {
					if (!picked) {
						annotation.select(at);
					}
				}}
				onChange={(event) => annotation.write(at, event.target.value)}
				onKeyDown={(event) => {
					if (
						(event.metaKey || event.ctrlKey) &&
						event.key === "z" &&
						note === ""
					) {
						// Nothing written yet, so the field has no text to undo: the
						// shortcut takes back the mark itself.
						event.preventDefault();
						annotation.undo();
					} else if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						// Back to the board, where Undo and Delete work again.
						event.currentTarget
							.closest<HTMLElement>("[data-slot=annotate]")
							?.focus();
						annotation.select(null);
					}
				}}
				className="field-sizing-content max-h-48 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base text-white leading-6 caret-[#ff1f8f] outline-none placeholder:text-white/40"
			/>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={`remove mark ${at + 1}`}
				onClick={() => annotation.remove(at)}
				className="mt-0.5 text-white/60 hover:bg-white/10 hover:text-white"
			>
				<Trash2Icon />
			</Button>
		</li>
	);
}
