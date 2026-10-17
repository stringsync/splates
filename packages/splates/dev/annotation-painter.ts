import type { Annotation } from "./annotation";
import type { Mark } from "./annotation-mark";

/** The marks' color: vivid magenta, which a screenshot of a UI rarely has. */
const INK = "#ff1f8f";

/**
 * Draws the image, then its marks and the one being dragged out, in the
 * image's pixels: the image's top left corner at `context`'s origin.
 */
export function drawMarks(
	context: CanvasRenderingContext2D,
	annotation: Annotation,
): void {
	context.drawImage(annotation.image, 0, 0);
	context.save();
	context.lineCap = "round";
	context.lineJoin = "round";
	const all =
		annotation.draft === null
			? annotation.marks
			: [...annotation.marks, annotation.draft];
	all.forEach((mark, at) => {
		line(context, annotation, mark, at);
		if (mark !== annotation.draft) {
			number(context, annotation, at);
		}
	});
	context.restore();
}

/**
 * Mark `at`'s line: a box's edges, an arrow, or the stem from a pin's
 * number down to a ring on its spot. A dark shadow, then a white halo,
 * then the ink: it reads on any background, light, dark or busy.
 */
function line(
	context: CanvasRenderingContext2D,
	annotation: Annotation,
	mark: Mark,
	at: number,
): void {
	const { from, to } = mark;
	const path = new Path2D();
	if (mark.kind === "box") {
		path.rect(
			Math.min(from.x, to.x),
			Math.min(from.y, to.y),
			Math.abs(to.x - from.x),
			Math.abs(to.y - from.y),
		);
	} else if (mark.kind === "arrow") {
		const angle = Math.atan2(to.y - from.y, to.x - from.x);
		const head = annotation.stroke * 4;
		path.moveTo(from.x, from.y);
		path.lineTo(to.x, to.y);
		for (const side of [-1, 1]) {
			path.moveTo(to.x, to.y);
			path.lineTo(
				to.x - head * Math.cos(angle + side * 0.5),
				to.y - head * Math.sin(angle + side * 0.5),
			);
		}
	} else {
		const anchor = annotation.anchor(at);
		path.moveTo(anchor.x, anchor.y);
		path.lineTo(from.x, from.y);
		// A ring on the spot itself, so the stem plainly ends somewhere.
		path.moveTo(from.x + annotation.stroke, from.y);
		path.arc(from.x, from.y, annotation.stroke, 0, Math.PI * 2);
	}
	context.shadowColor = "rgba(0, 0, 0, 0.55)";
	context.shadowBlur = annotation.stroke * 1.5;
	context.strokeStyle = "white";
	context.lineWidth = annotation.stroke * 2;
	context.stroke(path);
	context.shadowColor = "transparent";
	context.strokeStyle = INK;
	context.lineWidth = annotation.stroke;
	context.stroke(path);
}

/** Mark `at`'s number in a ringed disc, at its anchor. */
function number(
	context: CanvasRenderingContext2D,
	annotation: Annotation,
	at: number,
): void {
	const { x, y } = annotation.anchor(at);
	const radius = annotation.badge;
	context.shadowColor = "rgba(0, 0, 0, 0.55)";
	context.shadowBlur = annotation.stroke * 1.5;
	context.fillStyle = "white";
	context.beginPath();
	context.arc(x, y, radius + annotation.stroke * 0.6, 0, Math.PI * 2);
	context.fill();
	context.shadowColor = "transparent";
	context.fillStyle = at === annotation.selected ? "#c2006a" : INK;
	context.beginPath();
	context.arc(x, y, radius, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "white";
	context.font = `700 ${Math.round(radius * 1.15)}px system-ui, sans-serif`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(String(at + 1), x, y + radius * 0.06);
}
