import {
	CircleCheckIcon,
	CircleXIcon,
	InfoIcon,
	type LucideIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { fileUrl } from "./api";
import { DiagramView } from "./diagram-view";
import {
	type Block,
	type Chart,
	leading,
	type Shot,
	type Tone,
} from "./findings-blocks";
import { useLightbox } from "./lightbox";
import { Markdown } from "./markdown";

/** Draws one block of a card's body: prose, or a read-only readout (stats, chart, progress, steps, gallery, d2 diagram, callout, status table). */
export function BlockView({
	block,
	lead,
}: {
	block: Block;
	lead: boolean;
}): JSX.Element {
	switch (block.kind) {
		case "markdown":
			return (
				<Markdown
					text={block.text}
					className={cn("text-sm", lead && "text-[0.95rem] font-medium")}
				/>
			);
		case "stats":
			return (
				<div className="grid grid-cols-2 gap-2.5 @md:grid-cols-4">
					{block.items.map((item) => (
						<div key={item.label} className="rounded-lg border px-3 py-2">
							<div className="text-muted-foreground text-xs">{item.label}</div>
							<div className="font-semibold text-2xl tracking-tight">
								{item.value}
							</div>
							{item.change !== null && (
								<div className={cn("text-xs", TEXT[item.tone])}>
									{item.change}
								</div>
							)}
						</div>
					))}
				</div>
			);
		case "callout":
			return (
				<div
					role="note"
					className={cn(
						"flex gap-2.5 rounded-lg border px-3 py-2 text-sm",
						TINT[block.tone],
					)}
				>
					<span className="mt-0.5">
						<Mark tone={block.tone} />
					</span>
					<Markdown text={block.text} className="[&_p]:my-0" />
				</div>
			);
		case "progress": {
			const total = block.parts.reduce((sum, each) => sum + each.value, 0) || 1;
			return (
				<div>
					<div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
						{block.parts.map((part, i) => (
							<div
								key={part.label}
								title={`${part.label}: ${part.value}`}
								className={part.tone === "none" ? "" : FILL[part.tone]}
								style={{
									width: `${(part.value / total) * 100}%`,
									background:
										part.tone === "none"
											? SERIES[i % SERIES.length]
											: undefined,
								}}
							/>
						))}
					</div>
					<div className="mt-1 text-muted-foreground text-xs">
						{block.parts
							.map((each) => `${each.value} ${each.label}`)
							.join(" · ")}
					</div>
				</div>
			);
		}
		case "steps":
			return (
				<ol className="relative ml-1.5 pl-3.5 text-sm before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-0.5 before:bg-border [&>li:first-child]:mt-0 [&>li:last-child]:mb-0">
					{block.steps.map((step, i) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: steps may repeat
							key={i}
							className="relative my-1.5"
						>
							<span
								className={cn(
									"-left-[18px] absolute top-[5px] size-2.5 rounded-full ring-2 ring-background",
									FILL[step.tone === "none" ? "none" : step.tone],
								)}
							/>
							{step.text}
							{step.note !== null && (
								<span className="text-muted-foreground"> · {step.note}</span>
							)}
						</li>
					))}
				</ol>
			);
		case "status":
			return (
				<table className="w-full text-left text-sm">
					<thead className="text-muted-foreground text-xs">
						<tr>
							{block.header.map((cell, i) => (
								<th
									// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
									key={i}
									className="px-2 py-1 font-medium"
								>
									{i === 0 && cell === "" ? (
										<span className="sr-only">Status</span>
									) : (
										cell
									)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{block.rows.map((row, at) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
								key={at}
								className={cn("border-t", TINT[row.tone])}
							>
								{row.cells.map((cell, col) => (
									<td
										// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
										key={col}
										className="px-2 py-1.5"
									>
										{col === 0 && (
											<span className="mr-1.5 inline-block align-text-bottom">
												<Mark tone={row.tone} />
											</span>
										)}
										<Markdown inline text={leading(cell).rest} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			);
		case "diagram":
			return <DiagramView source={block.source} />;
		case "gallery":
			return <GalleryView shots={block.shots} />;
		case "chart":
			return <ChartView chart={block.chart} />;
		case "details":
			return (
				<details>
					<summary className="cursor-pointer text-muted-foreground text-sm">
						{block.title}
					</summary>
					<Markdown text={block.text} className="mt-2 text-sm" />
				</details>
			);
		default:
			return block satisfies never;
	}
}

/** Screenshots in a row with captions; a click enlarges one in the lightbox. */
function GalleryView({ shots }: { shots: Shot[] }): JSX.Element {
	const { show, lightbox } = useLightbox();
	const items = shots.map((shot) => ({
		url: fileUrl(shot.src),
		alt: shot.caption,
		video: false,
	}));
	return (
		<div className="flex gap-3 overflow-x-auto pb-1">
			{shots.map((shot, at) => (
				<figure key={shot.src} className="m-0 w-48 shrink-0">
					<button
						type="button"
						aria-label={`enlarge ${shot.caption || "screenshot"}`}
						onClick={() => show(items, at)}
						className="block w-full cursor-zoom-in"
					>
						<img
							src={items[at]?.url}
							alt={shot.caption}
							className="aspect-video w-full rounded-md border object-cover object-top"
						/>
					</button>
					{shot.caption !== "" && (
						<figcaption className="mt-1 text-muted-foreground text-xs">
							{shot.caption}
						</figcaption>
					)}
				</figure>
			))}
			{lightbox}
		</div>
	);
}

const WIDTH = 600;
const HEIGHT = 80;

function ChartView({ chart }: { chart: Chart }): JSX.Element {
	const title =
		chart.title === "" ? null : (
			<div className="mb-2 font-semibold text-muted-foreground text-xs">
				{chart.title}
			</div>
		);
	const legend =
		chart.series.length > 1 ? (
			<div className="mt-1 flex flex-wrap gap-3 text-muted-foreground text-xs">
				{chart.series.map((each, at) => (
					<span key={each.name} className="flex items-center gap-1">
						<i
							className="inline-block size-2 rounded-sm"
							style={{ background: SERIES[at % SERIES.length] }}
						/>
						{each.name}
					</span>
				))}
			</div>
		) : null;
	if (chart.type === "line") {
		const values = chart.series.flatMap((each) => each.values);
		const low = Math.min(...values);
		const span = Math.max(...values) - low || 1;
		const left = (at: number): number =>
			chart.labels.length < 2
				? WIDTH / 2
				: 4 + (at * (WIDTH - 8)) / (chart.labels.length - 1);
		const top = (value: number): number =>
			8 + (1 - (value - low) / span) * (HEIGHT - 16);
		return (
			<div>
				{title}
				<svg
					role="img"
					aria-label={chart.title || "Line chart"}
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					className="w-full"
				>
					{[8, HEIGHT / 2, HEIGHT - 8].map((row) => (
						<line
							key={row}
							x1="0"
							x2={WIDTH}
							y1={row}
							y2={row}
							className="stroke-border"
						/>
					))}
					{chart.series.map((each, at) => {
						const color = SERIES[at % SERIES.length];
						const last = each.values.length - 1;
						return (
							<g key={each.name}>
								<polyline
									fill="none"
									stroke={color}
									strokeWidth="2"
									strokeLinejoin="round"
									points={each.values
										.map((value, where) => `${left(where)},${top(value)}`)
										.join(" ")}
								/>
								<circle
									cx={left(last)}
									cy={top(each.values[last] ?? 0)}
									r="4.5"
									fill={color}
									className="stroke-background"
									strokeWidth="2"
								/>
							</g>
						);
					})}
				</svg>
				<div className="flex justify-between text-muted-foreground text-xs">
					<span>{chart.labels[0]}</span>
					<span>{chart.labels[chart.labels.length - 1]}</span>
				</div>
				{legend}
			</div>
		);
	}
	// A bar chart draws its first series; a stacked one adds them end to end.
	const drawn = chart.type === "bar" ? chart.series.slice(0, 1) : chart.series;
	const totals = chart.labels.map((_, row) =>
		drawn.reduce((sum, each) => sum + (each.values[row] ?? 0), 0),
	);
	const max = Math.max(...totals, 1);
	return (
		<div>
			{title}
			{chart.labels.map((label, row) => (
				<div key={label} className="my-1.5 flex items-center gap-2 text-sm">
					<span className="w-28 shrink-0 truncate text-muted-foreground">
						{label}
					</span>
					<div className="flex min-w-0 flex-1 items-center gap-0.5">
						{drawn.map((each, at) => (
							<div
								key={each.name}
								title={`${each.name}: ${each.values[row]}`}
								className="h-3 rounded-r"
								style={{
									width: `${((each.values[row] ?? 0) / max) * 85}%`,
									background: SERIES[at % SERIES.length],
								}}
							/>
						))}
						<span className="ml-1 shrink-0 text-muted-foreground text-xs">
							{totals[row]}
						</span>
					</div>
				</div>
			))}
			{legend}
		</div>
	);
}

const TEXT: Record<Tone, string> = {
	good: "text-emerald-600 dark:text-emerald-400",
	warn: "text-amber-600 dark:text-amber-400",
	bad: "text-red-600 dark:text-red-400",
	info: "text-blue-600 dark:text-blue-400",
	none: "text-muted-foreground",
};
const FILL: Record<Tone, string> = {
	good: "bg-emerald-500",
	warn: "bg-amber-500",
	bad: "bg-red-500",
	info: "bg-blue-500",
	none: "bg-blue-500",
};
const TINT: Record<Tone, string> = {
	good: "bg-emerald-500/10 border-emerald-500/30",
	warn: "bg-amber-500/10 border-amber-500/30",
	bad: "bg-red-500/10 border-red-500/30",
	info: "bg-blue-500/10 border-blue-500/30",
	none: "bg-muted border-border",
};
const MARK: Record<Tone, LucideIcon | null> = {
	good: CircleCheckIcon,
	warn: TriangleAlertIcon,
	bad: CircleXIcon,
	info: InfoIcon,
	none: null,
};

/** A status as its icon, in the tone's color; nothing for no status. */
function Mark({ tone }: { tone: Tone }): JSX.Element | null {
	const Icon = MARK[tone];
	return Icon === null ? null : (
		<Icon aria-hidden className={cn("size-4 shrink-0", TEXT[tone])} />
	);
}
/** Categorical series colors, in a fixed order. */
const SERIES = [
	"#2a78d6",
	"#eb6834",
	"#1baf7a",
	"#eda100",
	"#e87ba4",
	"#6250d6",
];
