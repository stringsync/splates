import { afterEach, describe, expect, it } from "bun:test";
import type { D2Draw } from "./d2-draw";
import { answerFrameDiagrams } from "./frame-diagrams";

/** An engine that draws a diagram as its own source, or fails on "bad". */
const ENGINE = {
	draw: async (source: string) => {
		if (source === "bad") {
			throw new Error("no");
		}
		return `<svg>${source}</svg>`;
	},
} as unknown as D2Draw;

describe("answerFrameDiagrams", () => {
	let stop = () => {};
	afterEach(() => {
		stop();
		document.body.innerHTML = "";
	});

	function framed(): { frame: Window; sent: unknown[] } {
		const iframe = document.createElement("iframe");
		document.body.append(iframe);
		const frame = iframe.contentWindow as Window;
		const sent: unknown[] = [];
		frame.postMessage = ((message: unknown) => {
			sent.push(message);
		}) as Window["postMessage"];
		return { frame, sent };
	}

	function ask(source: unknown, data: unknown): void {
		window.dispatchEvent(
			new MessageEvent("message", { data, source: source as Window }),
		);
	}

	it("answers a frame of the page with the drawn SVG, and without one when drawing fails", async () => {
		stop = answerFrameDiagrams(window, ENGINE);
		const { frame, sent } = framed();
		ask(frame, { splates: "d2", id: "d2-0", source: "a -> b" });
		ask(frame, { splates: "d2", id: "d2-1", source: "bad" });
		await Bun.sleep(0);
		expect(sent).toEqual([
			{ splates: "d2-drawn", id: "d2-0", svg: "<svg>a -> b</svg>" },
			{ splates: "d2-drawn", id: "d2-1" },
		]);
	});

	it("ignores windows that are not its frames and messages of other kinds", async () => {
		stop = answerFrameDiagrams(window, ENGINE);
		const { frame, sent } = framed();
		const stranger = { postMessage: () => sent.push("stranger") };
		ask(stranger, { splates: "d2", id: "d2-0", source: "a" });
		ask(frame, { splates: "selection", text: "a" });
		ask(frame, { splates: "d2", id: 3, source: "a" });
		await Bun.sleep(0);
		expect(sent).toEqual([]);
	});
});
