import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { Markdown } from "./markdown";

/**
 * A Markdown text field: the source in a plain monospace box, and how it
 * reads. On a phone, Write and Preview tabs take turns; from `md` up, the
 * two sit side by side.
 */
export function MarkdownEditor({
	value,
	onChange,
	label,
	placeholder,
	required,
}: {
	value: string;
	onChange: (value: string) => void;
	/** The source box's accessible name. */
	label: string;
	placeholder?: string;
	required?: boolean;
}): JSX.Element {
	const [previewing, setPreviewing] = useState(false);
	return (
		<div className="overflow-hidden rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
			<div className="flex items-center gap-0.5 border-b bg-muted/60 px-1.5 py-1">
				<div
					role="tablist"
					aria-label="Markdown view"
					className="flex md:hidden"
				>
					{(["Write", "Preview"] as const).map((tab) => {
						const selected = (tab === "Preview") === previewing;
						return (
							<button
								key={tab}
								type="button"
								role="tab"
								aria-selected={selected}
								onClick={() => setPreviewing(tab === "Preview")}
								className={cn(
									"whitespace-nowrap rounded-md px-3 py-1 text-sm",
									selected
										? "bg-background font-medium shadow-xs"
										: "text-muted-foreground",
								)}
							>
								{tab}
							</button>
						);
					})}
				</div>
				<span className="hidden px-2 font-medium text-muted-foreground text-xs md:inline">
					Markdown
				</span>
			</div>
			<div className="grid md:grid-cols-2">
				<textarea
					aria-label={label}
					required={required}
					placeholder={placeholder}
					value={value}
					onChange={(change) => onChange(change.target.value)}
					className={cn(
						"field-sizing-content max-h-[32rem] min-h-48 w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed outline-none placeholder:text-muted-foreground pointer-coarse:text-base",
						previewing && "max-md:hidden",
					)}
				/>
				<section
					aria-label="Preview"
					className={cn(
						"max-h-[32rem] min-h-48 overflow-auto px-4 py-2.5 text-sm md:border-l",
						!previewing && "max-md:hidden",
					)}
				>
					<p className="mb-2 hidden font-medium text-muted-foreground text-xs uppercase md:block">
						Preview
					</p>
					{value.trim() === "" ? (
						<p className="text-muted-foreground">Nothing to preview yet.</p>
					) : (
						<Markdown text={value} />
					)}
				</section>
			</div>
		</div>
	);
}
