import { color } from "@webappwiz/log";

/**
 * Columns padded to their widest cell. Padding goes by visible width, not
 * string length: cells carry color codes.
 */
export function table(header: string[], rows: string[][]): string {
	const width = (cell: string): number => color.strip(cell).length;
	const widths = header.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => width(r[i] ?? ""))),
	);
	const line = (cells: string[]): string =>
		cells
			.map((c, i) => c.padEnd((widths[i] ?? 0) + c.length - width(c)))
			.join("  ")
			.trimEnd();
	return [color.dim(line(header)), ...rows.map(line)].join("\n");
}
