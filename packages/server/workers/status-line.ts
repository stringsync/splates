import { color } from "webappwiz/log";

/**
 * Writes `line` on stderr as a runner's step, apart from the command's own
 * output: tagged `runner`, in `tone` when stderr is a terminal.
 */
export function statusLine(
	line: string,
	tone: (value: unknown) => string = color.blue,
	write: (text: string) => void = (text) => void process.stderr.write(text),
	colored: boolean = process.stderr.isTTY === true,
): void {
	const shown = `${color.bold(color.blue("runner"))} ${tone(line)}`;
	write(`${colored ? shown : color.strip(shown)}\n`);
}
