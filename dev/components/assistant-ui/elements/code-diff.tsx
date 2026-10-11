"use client";

import type { ComponentProps } from "react";
import { cn } from "#dev/lib/utils.ts";
import { codeScroll, codeSurface, mono, paper } from "./surfaces";

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

const GUTTER: Record<DiffKind, string> = {
	context: "",
	added: "+",
	removed: "−",
};

export function CodeDiff({
	filename,
	additions,
	deletions,
	lines,
	className,
	...props
}: Omit<
	ComponentProps<"div">,
	"children" | "filename" | "additions" | "deletions" | "lines"
> & {
	filename: string;
	additions: number;
	deletions: number;
	lines: readonly DiffLine[];
}) {
	return (
		<div
			data-slot="code-diff"
			className={cn(
				paper,
				"w-full max-w-md overflow-hidden rounded-2xl font-mono text-xs",
				className,
			)}
			{...props}
		>
			<div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
				{/* arbor: a long path keeps its end, the file's name, on one line. */}
				<span
					title={filename}
					className="min-w-0 truncate text-left text-foreground/90 [direction:rtl]"
				>
					<bdi>{filename}</bdi>
				</span>
				<span className={cn(mono, "shrink-0 tabular-nums")}>
					<span className="text-emerald-600 dark:text-emerald-400">
						+{additions}
					</span>{" "}
					<span className="text-red-600 dark:text-red-400">−{deletions}</span>
				</span>
			</div>
			<div className={codeScroll}>
				<div className={codeSurface}>
					{lines.map((line, i) => (
						<div
							// arbor: lines never reorder, and the same text can repeat.
							// biome-ignore lint/suspicious/noArrayIndexKey: as above
							key={i}
							className={cn(
								"flex px-4 py-0.5 leading-relaxed whitespace-pre",
								line.kind === "context" && "text-muted-foreground",
								line.kind === "added" &&
									"bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
								line.kind === "removed" &&
									"bg-red-500/10 text-red-700 dark:text-red-300",
							)}
						>
							<span className="w-4 shrink-0 select-none">
								{GUTTER[line.kind]}
							</span>
							<span>{line.text}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
