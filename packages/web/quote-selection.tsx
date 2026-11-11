import { useAui } from "@assistant-ui/react";
import { QuoteIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { focusComposer } from "./composer-editor";

/** `text` as a `>` block, a blank line after it for the person's reply. */
export function quoted(text: string): string {
	const lines = text.trim().split(/\r?\n/);
	return `${lines.map((line) => `> ${line}`.trimEnd()).join("\n")}\n\n`;
}

/**
 * Wraps words the person can select: a Quote button shows beside a selection
 * inside them, and puts it in the composer as a `>` block.
 */
export function Quotable({ children }: { children: ReactNode }): JSX.Element {
	const aui = useAui();
	const box = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState<string | null>(null);
	useEffect(() => {
		const check = () => {
			const selection = document.getSelection();
			const text = selection?.toString() ?? "";
			const inside =
				selection !== null &&
				!selection.isCollapsed &&
				box.current?.contains(selection.anchorNode) &&
				box.current.contains(selection.focusNode);
			setSelected(inside && text.trim() !== "" ? text : null);
		};
		document.addEventListener("selectionchange", check);
		return () => document.removeEventListener("selectionchange", check);
	}, []);
	return (
		<div ref={box} data-slot="quotable" className="flex flex-col gap-1">
			{children}
			{selected !== null && (
				<button
					type="button"
					// Keeps the selection while it is pressed.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						const composer = aui.composer();
						const before = composer.getState().text;
						const gap =
							before === ""
								? ""
								: before.endsWith("\n\n")
									? ""
									: before.endsWith("\n")
										? "\n"
										: "\n\n";
						composer.setText(`${before}${gap}${quoted(selected)}`);
						document.getSelection()?.removeAllRanges();
						focusComposer();
					}}
					className="flex w-fit cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-muted-foreground text-xs hover:text-foreground"
				>
					<QuoteIcon className="size-3" />
					Quote
				</button>
			)}
		</div>
	);
}
