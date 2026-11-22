import { Position } from "core/geometry";
import { useReactive } from "core/react";
import { MoveUpRightIcon, SquareIcon, Undo2Icon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import type { Annotation, Tool } from "./annotation";

/** The existing annotation model on a capture in the plan's own sheet. */
export function PlanMarkup({
	annotation,
	onLive,
}: {
	annotation: Annotation;
	onLive: () => void;
}): JSX.Element {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [tool, setTool] = useState<Tool | null>(null);
	const state = useReactive(
		annotation,
		(each) => ({
			marks: each.marks,
			selected: each.selected,
			draft: each.draft,
		}),
		["changed"],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: every model change repaints
	useEffect(() => {
		const context = canvas.current?.getContext("2d");
		if (context === null || context === undefined) {
			return;
		}
		context.clearRect(0, 0, annotation.width, annotation.height);
		annotation.draw(context);
	}, [annotation, state]);
	return (
		<div
			className="absolute inset-0 flex min-h-0 flex-col gap-2"
			data-slot="annotate"
			tabIndex={-1}
		>
			<div
				className="flex shrink-0 flex-wrap items-center gap-1"
				role="toolbar"
				aria-label="markup tools"
			>
				{(
					[
						{ name: "arrow", icon: <MoveUpRightIcon />, label: "Arrow" },
						{ name: "box", icon: <SquareIcon />, label: "Box" },
					] as const
				).map((each) => (
					<Button
						key={each.name}
						size="sm"
						variant="ghost"
						aria-pressed={tool === each.name}
						className={cn(
							"text-white hover:bg-white/15 hover:text-white",
							tool === each.name && "bg-white/20",
						)}
						onClick={() => {
							annotation.use(each.name);
							setTool(tool === each.name ? null : each.name);
						}}
					>
						{each.icon}
						{each.label}
					</Button>
				))}
				<Button
					size="sm"
					variant="ghost"
					className="text-white hover:bg-white/15 hover:text-white"
					disabled={state.marks.length === 0}
					onClick={() => annotation.undo()}
				>
					<Undo2Icon />
					Undo
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="ml-auto text-white hover:bg-white/15 hover:text-white"
					onClick={onLive}
				>
					Back to live plan
				</Button>
			</div>
			<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-white/5">
				<canvas
					ref={canvas}
					width={annotation.width}
					height={annotation.height}
					aria-label="plan capture markup"
					className={cn(
						"max-h-full max-w-full touch-none object-contain",
						tool !== null ? "cursor-crosshair" : "cursor-default",
					)}
					style={{ aspectRatio: `${annotation.width}/${annotation.height}` }}
					onPointerDown={(event) => {
						if (event.button !== 0) {
							return;
						}
						const box = event.currentTarget.getBoundingClientRect();
						const point = new Position(
							((event.clientX - box.left) * annotation.width) / box.width,
							((event.clientY - box.top) * annotation.height) / box.height,
						);
						if (tool === null) {
							annotation.select(
								annotation.markAt(point, (10 * annotation.width) / box.width),
							);
							return;
						}
						event.currentTarget.setPointerCapture(event.pointerId);
						annotation.press(point);
					}}
					onPointerMove={(event) => {
						const box = event.currentTarget.getBoundingClientRect();
						annotation.move(
							new Position(
								((event.clientX - box.left) * annotation.width) / box.width,
								((event.clientY - box.top) * annotation.height) / box.height,
							),
						);
					}}
					onPointerUp={() => {
						annotation.release();
						setTool(null);
					}}
					onPointerCancel={() => {
						annotation.select(null);
						annotation.draft = null;
						setTool(null);
					}}
				/>
			</div>
			<p className="shrink-0 text-white/60 text-xs">
				{tool === null
					? "Select a mark to edit its note. Pick a tool to add another."
					: "Drag one shape, or click to pin a note."}
			</p>
		</div>
	);
}
