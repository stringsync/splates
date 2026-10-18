import { color } from "webappwiz/log";

/**
 * Columns padded to their widest cell. Padding goes by visible width, not
 * string length: cells carry color codes.
 */
export function table(header: string[], rows: string[][]): string {
	const width = (cell: string): number => color.strip(cell).length;
	const widths = header.map((heading, i) =>
		Math.max(heading.length, ...rows.map((row) => width(row[i] ?? ""))),
	);
	const line = (cells: string[]): string =>
		cells
			.map((cell, i) =>
				cell.padEnd((widths[i] ?? 0) + cell.length - width(cell)),
			)
			.join("  ")
			.trimEnd();
	return [color.dim(line(header)), ...rows.map(line)].join("\n");
}
