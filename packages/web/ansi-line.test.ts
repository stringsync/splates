import { expect, test } from "bun:test";
import { renderAnsiLine } from "./ansi-line";

const text = (line: string) =>
	renderAnsiLine(line)
		.map((span) => span.text)
		.join("");

test("a spinner redrawn with cursor-to-column and erase-line shows its last frame", () => {
	expect(
		text("⠋\u001b[1G\u001b[0K⠙\u001b[1G\u001b[0K\u001b[1mnpm\u001b[22m error"),
	).toBe("npm error");
});

test("a carriage return overwrites from the start", () => {
	expect(text("abcdef\rxy")).toBe("xycdef");
});

test("colour codes become spans and other escapes are dropped", () => {
	expect(
		renderAnsiLine(
			"\u001b[31merror\u001b[39m \u001b[94mcode\u001b[39m\u001b[?25l",
		),
	).toEqual([
		{ text: "error", fg: 1, bold: false, dim: false },
		{ text: " ", fg: null, bold: false, dim: false },
		{ text: "code", fg: 12, bold: false, dim: false },
	]);
});

test("an OSC sequence is dropped", () => {
	expect(text("\u001b]0;title\u0007hi")).toBe("hi");
});
