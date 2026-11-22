import { Disposer, type Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import { Duration, SystemTimer } from "core/time";
import { Annotation } from "./annotation";

/** Captures kept with the questions, even after the plan sheet is closed. */
export class PlanMarkups implements Resource, Eventful<{ changed: undefined }> {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	private disposer = new Disposer();
	readonly annotations: Annotation[] = [];
	private disposed = false;

	async add(file: File): Promise<Annotation> {
		if (this.disposed) {
			throw new Error("The plan review is closed.");
		}
		const annotation = await Annotation.open(file);
		if (this.disposed) {
			annotation.dispose();
			throw new Error("The plan review is closed.");
		}
		this.annotations.push(annotation);
		this.disposer.use(annotation);
		this.disposer.defer(
			annotation.events.on("changed", () =>
				this.dispatcher.dispatch("changed"),
			),
		);
		this.dispatcher.dispatch("changed");
		return annotation;
	}

	get any(): boolean {
		return this.annotations.some((each) => each.marks.length > 0);
	}

	async files(): Promise<File[]> {
		return Promise.all(
			this.annotations
				.filter((each) => each.marks.length > 0)
				.map((each) => each.flatten()),
		);
	}

	clear(): void {
		this.disposer.dispose();
		this.disposer = new Disposer();
		this.annotations.length = 0;
		this.dispatcher.dispatch("changed");
	}

	dispose(): void {
		this.disposed = true;
		this.clear();
		this.dispatcher.dispose();
	}
}

/** Captures the visible plan as a PNG. Pass the plan frame opened with ?select. */
export async function capturePlan(frame: HTMLIFrameElement): Promise<File> {
	const svg = await new Promise<string>((resolve, reject) => {
		const finish = () => {
			window.removeEventListener("message", heard);
			deadline.dispose();
		};
		const heard = (event: MessageEvent) => {
			if (
				event.source !== frame.contentWindow ||
				event.data?.splates !== "plan-capture"
			) {
				return;
			}
			finish();
			if (typeof event.data.svg === "string") {
				resolve(event.data.svg);
			} else {
				reject(new Error("The plan could not be captured."));
			}
		};
		const deadline = new SystemTimer().setTimeout(() => {
			finish();
			reject(new Error("The plan did not respond. Try opening it again."));
		}, Duration.secs(10));
		window.addEventListener("message", heard);
		frame.contentWindow?.postMessage({ splates: "capture-plan" }, "*");
	});
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (context === null) {
		throw new Error("This browser cannot capture the plan.");
	}
	context.drawImage(image, 0, 0);
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/png"),
	);
	if (blob === null) {
		throw new Error("This browser cannot save the plan capture.");
	}
	return new File([blob], "plan-markup.png", { type: "image/png" });
}
