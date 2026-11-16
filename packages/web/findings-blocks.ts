/**
 * Cuts the body of a card into the blocks it draws: prose, and read-only
 * readouts. Call `blocksOf` on the text; each readout is a fenced `stats`,
 * `chart`, `progress`, `steps`, `gallery` or `d2` block, a quote opening with a
 * status icon, a table led by status icons, or a closing `### Details`. Read
 * as plain markdown, each is still a table, quote or code block.
 */
export type Tone = "good" | "warn" | "bad" | "info" | "none";

/** The tone of the status icon `text` opens with, and the text after it. */
export function leading(text: string): { tone: Tone; rest: string } {
	const trimmed = text.trim();
	for (const [icon, tone] of ICONS) {
		if (trimmed.startsWith(icon)) {
			return { tone, rest: trimmed.slice(icon.length).trim() };
		}
	}
	return { tone: "none", rest: trimmed };
}

export type Block =
	| { kind: "markdown"; text: string }
	| { kind: "stats"; items: Stat[] }
	| { kind: "chart"; chart: Chart }
	| { kind: "progress"; parts: Part[] }
	| { kind: "steps"; steps: Step[] }
	| { kind: "gallery"; shots: Shot[] }
	| { kind: "diagram"; source: string }
	| { kind: "callout"; tone: Tone; text: string }
	| { kind: "status"; header: string[]; rows: StatusRow[] }
	| { kind: "details"; title: string; text: string };

export interface Stat {
	label: string;
	value: string;
	change: string | null;
	/** How the change reads: good, bad or warn when a status icon ends it. */
	tone: Tone;
}

export interface Chart {
	type: "line" | "bar" | "stacked";
	title: string;
	labels: string[];
	series: { name: string; values: number[] }[];
}

export interface Part {
	label: string;
	value: number;
	tone: Tone;
}

export interface Step {
	tone: Tone;
	text: string;
	note: string | null;
}

/** One screenshot of a gallery: an absolute path and its caption. */
export interface Shot {
	src: string;
	caption: string;
}

export interface StatusRow {
	tone: Tone;
	cells: string[];
}

const ICONS: [string, Tone][] = [
	["✅", "good"],
	["⚠️", "warn"],
	["⚠", "warn"],
	["❌", "bad"],
	["🛑", "bad"],
	["ℹ️", "info"],
	["💡", "info"],
];

function trailing(text: string): { tone: Tone; rest: string } {
	const trimmed = text.trim();
	for (const [icon, tone] of ICONS) {
		if (trimmed.endsWith(icon)) {
			return { tone, rest: trimmed.slice(0, -icon.length).trim() };
		}
	}
	return { tone: "none", rest: trimmed };
}

const FENCE = /^```(\S*)[ \t]*(.*)$/;

export function blocksOf(text: string): Block[] {
	const lines = text.split("\n");
	const blocks: Block[] = [];
	let prose: string[] = [];
	const flush = (): void => {
		const joined = prose.join("\n").trim();
		if (joined !== "") {
			blocks.push({ kind: "markdown", text: joined });
		}
		prose = [];
	};
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] as string;
		const fence = FENCE.exec(line);
		if (fence !== null) {
			let end = i + 1;
			while (end < lines.length && !/^```[ \t]*$/.test(lines[end] as string)) {
				end += 1;
			}
			const body = lines.slice(i + 1, end);
			const block = readout(fence[1] as string, fence[2] as string, body);
			if (block !== null && end < lines.length) {
				flush();
				blocks.push(block);
			} else {
				prose.push(...lines.slice(i, Math.min(end + 1, lines.length)));
			}
			i = end;
			continue;
		}
		const details = /^###[ \t]+(Details|More)[ \t]*$/i.exec(line);
		if (details !== null) {
			flush();
			blocks.push({
				kind: "details",
				title: details[1] as string,
				text: lines
					.slice(i + 1)
					.join("\n")
					.trim(),
			});
			return blocks;
		}
		if (line.startsWith(">")) {
			let end = i;
			while (
				end + 1 < lines.length &&
				(lines[end + 1] as string).startsWith(">")
			) {
				end += 1;
			}
			const quote = lines
				.slice(i, end + 1)
				.map((each) => each.replace(/^>[ \t]?/, ""))
				.join("\n");
			const { tone, rest } = leading(quote);
			if (tone !== "none") {
				flush();
				blocks.push({ kind: "callout", tone, text: rest });
				i = end;
				continue;
			}
		}
		if (line.trimStart().startsWith("|")) {
			let end = i;
			while (
				end + 1 < lines.length &&
				(lines[end + 1] as string).trimStart().startsWith("|")
			) {
				end += 1;
			}
			const table = statusTable(lines.slice(i, end + 1));
			if (table !== null) {
				flush();
				blocks.push(table);
				i = end;
				continue;
			}
		}
		prose.push(line);
	}
	flush();
	return blocks;
}

function readout(name: string, info: string, body: string[]): Block | null {
	const rows = body.filter((each) => each.trim() !== "");
	switch (name) {
		case "stats": {
			const items = rows.flatMap((row): Stat[] => {
				const at = row.indexOf(":");
				if (at === -1) {
					return [];
				}
				const rest = row.slice(at + 1).trim();
				const change = /^(.*?)\s*\((.*)\)\s*$/.exec(rest);
				const closing = trailing(change?.[2] ?? "");
				return [
					{
						label: row.slice(0, at).trim(),
						value: (change?.[1] ?? rest).trim(),
						change: change === null ? null : closing.rest,
						tone: closing.tone,
					},
				];
			});
			return items.length === 0 ? null : { kind: "stats", items };
		}
		case "progress": {
			const parts = rows.flatMap((row): Part[] => {
				const at = row.lastIndexOf(":");
				const value = Number(row.slice(at + 1).replace(/[^\d.-]/g, ""));
				if (at === -1 || Number.isNaN(value)) {
					return [];
				}
				const { tone, rest } = leading(row.slice(0, at));
				return [{ label: rest, value, tone }];
			});
			return parts.length === 0 ? null : { kind: "progress", parts };
		}
		case "steps": {
			const steps = rows.map((row): Step => {
				const { tone, rest } = leading(
					row.replace(/^(?:\d+\.|[-*])[ \t]+/, ""),
				);
				const at = rest.indexOf(" · ");
				return {
					tone,
					text: at === -1 ? rest : rest.slice(0, at),
					note: at === -1 ? null : rest.slice(at + 3),
				};
			});
			return steps.length === 0 ? null : { kind: "steps", steps };
		}
		case "d2": {
			const source = body.join("\n").trim();
			return source === "" ? null : { kind: "diagram", source };
		}
		case "gallery": {
			const shots = rows.flatMap((row): Shot[] => {
				const image = /^!\[(.*)\]\((\/[^)\s]+)\)$/.exec(row.trim());
				return image === null
					? []
					: [{ src: image[2] as string, caption: (image[1] as string).trim() }];
			});
			return shots.length === 0 ? null : { kind: "gallery", shots };
		}
		case "chart": {
			const [kind, ...title] = info.split(":");
			const type = (kind ?? "").trim();
			if (type !== "line" && type !== "bar" && type !== "stacked") {
				return null;
			}
			const cells = rows
				.filter((row) => row.trimStart().startsWith("|"))
				.map(cellsOf);
			const [head, rule, ...data] = cells;
			if (head === undefined || rule === undefined || data.length === 0) {
				return null;
			}
			const series = head.slice(1).map((header, column) => ({
				name: header,
				values: data.map((row) =>
					Number((row[column + 1] ?? "").replace(/[^\d.-]/g, "")),
				),
			}));
			if (
				series.length === 0 ||
				series.some((each) => each.values.some(Number.isNaN))
			) {
				return null;
			}
			return {
				kind: "chart",
				chart: {
					type,
					title: title.join(":").trim(),
					labels: data.map((row) => row[0] ?? ""),
					series,
				},
			};
		}
		default:
			return null;
	}
}

function cellsOf(row: string): string[] {
	return row
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

/** A table whose every body row opens with a status icon. */
function statusTable(lines: string[]): Block | null {
	const [head, rule, ...body] = lines.map(cellsOf);
	if (
		head === undefined ||
		rule === undefined ||
		!rule.every((cell) => /^:?-+:?$/.test(cell)) ||
		body.length === 0
	) {
		return null;
	}
	const rows = body.map((cells) => {
		const { tone, rest } = leading(cells[0] ?? "");
		return { tone, cells: [rest, ...cells.slice(1)] };
	});
	if (rows.some((row) => row.tone === "none")) {
		return null;
	}
	return { kind: "status", header: head, rows };
}
