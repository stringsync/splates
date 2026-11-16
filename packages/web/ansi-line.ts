/** One run of text in a terminal line, with the colours and weight in force. */
export type AnsiSpan = {
	text: string;
	fg: number | null;
	bold: boolean;
	dim: boolean;
};

type Cell = { ch: string; fg: number | null; bold: boolean; dim: boolean };

// ESC [ params intermediates final, or ESC ] ... (BEL | ESC \), or a lone ESC x.
const SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes
	/\u001b\[([0-9;?]*)[ -/]*([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/y;

/**
 * Replays one line of terminal output the way a terminal would show it:
 * carriage returns and cursor-to-column moves overwrite, erase-line clears,
 * colour codes become spans, and every other escape is dropped. This is what
 * lets a spinner that redraws itself in place read as its final frame.
 */
export function renderAnsiLine(line: string): AnsiSpan[] {
	const cells: Cell[] = [];
	let column = 0;
	let fg: number | null = null;
	let bold = false;
	let dim = false;
	let index = 0;
	while (index < line.length) {
		const char = line[index] as string;
		if (char === "\u001b") {
			SEQUENCE.lastIndex = index;
			const match = SEQUENCE.exec(line);
			if (!match) {
				index += 1;
				continue;
			}
			index += match[0].length;
			const params = (match[1] ?? "")
				.split(";")
				.map((part) => Number(part) || 0);
			switch (match[2]) {
				case "m":
					for (const code of params) {
						if (code === 0) {
							fg = null;
							bold = false;
							dim = false;
						} else if (code === 1) {
							bold = true;
						} else if (code === 2) {
							dim = true;
						} else if (code === 22) {
							bold = false;
							dim = false;
						} else if (code >= 30 && code <= 37) {
							fg = code - 30;
						} else if (code >= 90 && code <= 97) {
							fg = code - 90 + 8;
						} else if (code === 39) {
							fg = null;
						}
					}
					break;
				case "G":
					column = Math.max(0, (params[0] || 1) - 1);
					break;
				case "D":
					column = Math.max(0, column - (params[0] || 1));
					break;
				case "C":
					column += params[0] || 1;
					break;
				case "K":
					if (params[0] === 2) {
						cells.length = 0;
					} else if (params[0] === 1) {
						for (let i = 0; i < column; i++) {
							cells[i] = { ch: " ", fg: null, bold: false, dim: false };
						}
					} else {
						cells.length = Math.min(cells.length, column);
					}
					break;
			}
			continue;
		}
		index += 1;
		if (char === "\r") {
			column = 0;
		} else if (char === "\b") {
			column = Math.max(0, column - 1);
		} else if (char >= " " || char === "\t") {
			while (cells.length < column) {
				cells.push({ ch: " ", fg: null, bold: false, dim: false });
			}
			cells[column] = { ch: char, fg, bold, dim };
			column += 1;
		}
	}
	const spans: AnsiSpan[] = [];
	for (const cell of cells) {
		const last = spans.at(-1);
		if (
			last &&
			last.fg === cell.fg &&
			last.bold === cell.bold &&
			last.dim === cell.dim
		) {
			last.text += cell.ch;
		} else {
			spans.push({
				text: cell.ch,
				fg: cell.fg,
				bold: cell.bold,
				dim: cell.dim,
			});
		}
	}
	return spans;
}
