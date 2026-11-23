import { useReactive } from "core/react";
import { CheckIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { type JSX, type RefObject, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { LIGHT, TOOLS } from "./annotate-tools";
import type { Annotation } from "./annotation";

/**
 * The tools on a phone, in a dock at the foot of the screen where a thumb
 * reaches: Arrow and Box, Undo and Clear.
 */
export function ToolDock({
	annotation,
}: {
	annotation: Annotation;
}): JSX.Element {
	const { marks, tool } = useReactive(
		annotation,
		(each) => ({ marks: each.marks, tool: each.tool }),
		["changed"],
	);
	return (
		<div className="flex w-full shrink-0 items-center justify-between gap-2 rounded-3xl border border-white/10 bg-[#1c1c1f] p-1.5">
			<fieldset
				aria-label="tool"
				className="flex rounded-2xl bg-white/10 p-0.5"
			>
				{TOOLS.map((each) => (
					<Button
						key={each.tool}
						variant="ghost"
						aria-pressed={tool === each.tool}
						onClick={() => annotation.use(each.tool)}
						className={cn(
							LIGHT,
							"h-9 rounded-[14px] px-3.5",
							tool === each.tool && "bg-white! text-black! hover:bg-white!",
						)}
					>
						{each.icon}
						{each.label}
					</Button>
				))}
			</fieldset>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					disabled={marks.length === 0}
					onClick={() => annotation.undo()}
					aria-label="Undo"
					className={LIGHT}
				>
					<Undo2Icon />
				</Button>
				<Button
					variant="ghost"
					disabled={marks.length === 0}
					onClick={() => annotation.clear()}
					className={LIGHT}
				>
					Clear
				</Button>
			</div>
		</div>
	);
}

/**
 * The marks' notes on a phone, to render under the image, above the keyboard:
 * a chip for each mark picks it, and the picked mark's note is written in the
 * one field below. Pass the board the same `field` to focus it on a new mark.
 */
export function NoteBar({
	annotation,
	field,
}: {
	annotation: Annotation;
	/** The note field, which the board focuses when a mark is drawn. */
	field: RefObject<HTMLTextAreaElement | null>;
}): JSX.Element | null {
	const { marks, selected } = useReactive(
		annotation,
		(each) => ({ marks: each.marks, selected: each.selected }),
		["changed"],
	);
	const chips = useRef<HTMLUListElement>(null);
	// The picked mark's chip stays in sight in a row too long for the screen.
	useEffect(() => {
		if (selected !== null) {
			chips.current?.children[selected]?.scrollIntoView?.({
				block: "nearest",
				inline: "nearest",
			});
		}
	}, [selected]);
	if (marks.length === 0) {
		return null;
	}
	const note = selected === null ? "" : (marks[selected]?.note ?? "");
	const putDown = () => {
		field.current
			?.closest<HTMLElement>("[data-slot=annotate]")
			?.focus({ preventScroll: true });
		annotation.select(null);
	};
	return (
		<section
			aria-label="marks"
			className="-mx-3 flex w-[calc(100%+1.5rem)] shrink-0 flex-col gap-2.5 border-white/10 border-t bg-[#141416] px-3 pt-2.5 pb-2"
		>
			<ul
				ref={chips}
				className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]"
			>
				{marks.map((mark, at) => (
					<li
						// A mark is told apart by where it was drawn.
						key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
						className="shrink-0"
					>
						<button
							type="button"
							aria-pressed={at === selected}
							onClick={() => {
								// Picked and focused in the tap itself, so a phone raises its
								// keyboard.
								flushSync(() => annotation.select(at));
								field.current?.focus();
							}}
							className={cn(
								"flex max-w-48 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-sm",
								at === selected
									? "bg-[#ff1f8f]/20 text-white ring-1 ring-[#ff1f8f]/60"
									: "bg-white/8 text-white/80",
							)}
						>
							<span
								className={cn(
									"flex size-5 shrink-0 items-center justify-center rounded-full font-bold text-[11px] text-white",
									at === selected ? "bg-[#ff1f8f]" : "bg-white/20",
								)}
							>
								{at + 1}
							</span>
							<span className="truncate">
								{mark.note.trim() === ""
									? at === selected
										? "Writing"
										: "No note"
									: mark.note}
							</span>
						</button>
					</li>
				))}
			</ul>
			{selected !== null && (
				<div className="flex items-end gap-1.5 rounded-[20px] border border-[#ff1f8f]/60 bg-[#1c1c1f] py-1 pr-1 pl-3.5">
					<textarea
						ref={field}
						rows={1}
						aria-label={`note on mark ${selected + 1}`}
						placeholder="What about it?"
						value={note}
						onChange={(event) => annotation.write(selected, event.target.value)}
						onKeyDown={(event) => {
							if (
								(event.metaKey || event.ctrlKey) &&
								event.key === "z" &&
								note === ""
							) {
								// Nothing written yet: the shortcut takes back the mark itself.
								event.preventDefault();
								annotation.undo();
							} else if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								putDown();
							}
						}}
						className="field-sizing-content max-h-32 min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-base text-white leading-6 caret-[#ff1f8f] outline-none placeholder:text-white/40"
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`remove mark ${selected + 1}`}
						onClick={() => annotation.remove(selected)}
						className="text-white/60 hover:bg-white/10 hover:text-white"
					>
						<Trash2Icon />
					</Button>
					<Button
						size="icon-sm"
						aria-label="Done with this note"
						onClick={putDown}
						className="rounded-full bg-[#ff1f8f] text-white hover:bg-[#ff1f8f]/85"
					>
						<CheckIcon />
					</Button>
				</div>
			)}
		</section>
	);
}
