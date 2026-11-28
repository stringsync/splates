import { parseInlineArtifactRef } from "@splates/server/artifacts/browser";
import { ChevronRightIcon, Maximize2Icon } from "lucide-react";
import {
	Children,
	isValidElement,
	type JSX,
	type MouseEvent,
	type ReactNode,
	useState,
} from "react";
import { fileUrl } from "./api";
import { useImagePreviewsExpanded } from "./image-previews";
import { InlineHtmlArtifact } from "./inline-artifact";
import { ITEM, type Shown, useLightbox } from "./lightbox";

/** The recordings a todo or a task may hold, by extension; `dev.ts` serves them. */
const VIDEO = /\.(mp4|webm|mov)$/i;

/** How many thumbnails a gallery card shows before counting the rest. */
const THUMBS = 3;

/** One screenshot or recording a document names: its stored path and caption. */
export interface Pictured {
	src: string;
	alt: string;
}

/**
 * Shows an attached screenshot or recording as a gallery card of one. Pass its
 * stored absolute path and a caption; any other path shows as its caption.
 */
export function Media({
	src = "",
	alt = "",
}: {
	src?: string;
	alt?: string;
}): JSX.Element {
	const artifact = parseInlineArtifactRef(src);
	if (artifact !== null) {
		return (
			<InlineHtmlArtifact
				name={artifact.name}
				version={artifact.version}
				alt={alt}
			/>
		);
	}
	return <Gallery items={[{ src, alt }]} />;
}

/**
 * A run of screenshots and recordings as one compact card: a few thumbnails,
 * how many there are and their captions. Clicking it opens the lightbox on the
 * first, stepping through every one in the document. One that splates does
 * not hold is named as unavailable; one off this machine is named by its
 * caption alone.
 */
export function Gallery({
	items,
}: {
	items: readonly Pictured[];
}): JSX.Element {
	const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
	const [sizes, setSizes] = useState<Readonly<Record<string, string>>>({});
	const expanded = useImagePreviewsExpanded();
	const { open, lightbox } = useLightbox();
	const artifacts = items.flatMap((item) => {
		const parsed = parseInlineArtifactRef(item.src);
		return parsed === null ? [] : [{ ...parsed, alt: item.alt }];
	});
	const nonArtifacts = items.filter(
		(item) => parseInlineArtifactRef(item.src) === null,
	);
	const local = nonArtifacts.filter((item) => item.src.startsWith("/"));
	const held = local.filter((item) => !failed.has(item.src));
	const lost = local.filter((item) => failed.has(item.src));
	const shown = held.map(
		(item): Shown => ({
			url: fileUrl(item.src),
			alt: item.alt,
			video: VIDEO.test(item.src),
		}),
	);
	const fail = (src: string) => setFailed((before) => new Set(before).add(src));
	const recordSize = (src: string, size: string) =>
		setSizes((before) =>
			before[src] === size ? before : { ...before, [src]: size },
		);
	const first = shown[0];
	const firstSrc = held[0]?.src;
	const many = shown.length > 1;
	const recordings = shown.every((item) => item.video);
	const kind = recordings ? "recording" : "image";
	const title = many
		? `${shown.length} ${recordings ? "recordings" : "images"}`
		: first?.alt || (first?.video ? "Recording" : "Image");
	const detail = many
		? shown.map((item) => item.alt || kind).join(" · ")
		: first?.video
			? "Recording"
			: ((firstSrc !== undefined ? sizes[firstSrc] : undefined) ?? "Image");
	const onClick = (event: MouseEvent<HTMLElement>) => {
		const thumb = event.currentTarget.querySelector(`[${ITEM}]`);
		if (thumb) {
			open(thumb);
		}
	};
	return (
		<>
			{artifacts.map((item, at) => (
				<InlineHtmlArtifact
					// biome-ignore lint/suspicious/noArrayIndexKey: an embed list never reorders
					key={`${item.name}:${item.version}:${at}`}
					name={item.name}
					version={item.version}
					alt={item.alt}
				/>
			))}
			{nonArtifacts
				.filter((item) => !item.src.startsWith("/"))
				.map((item) => (
					<Alt key={item.src} alt={item.alt} />
				))}
			{lost.map((item) => (
				<span key={item.src} role="status" className="text-muted-foreground">
					[{item.alt || "image"}: unavailable. The file may be missing, invalid,
					or too large to display.]
				</span>
			))}
			{first && expanded ? (
				<div className="my-2 flex min-w-0 flex-wrap items-start gap-2">
					{shown.map((item, at) => {
						const src = held[at]?.src ?? "";
						const size = sizes[src];
						if (item.video) {
							return (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: a run may show one file twice, and it never reorders
									key={at}
									{...{ [ITEM]: JSON.stringify(item) }}
									className="group/media relative flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground"
								>
									{/* biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions to give */}
									<video
										src={item.url}
										title={item.alt}
										controls
										preload="metadata"
										onError={() => fail(src)}
										className="block h-auto max-h-96 max-w-full"
									/>
									<button
										type="button"
										aria-label={`view ${item.alt || "recording"}`}
										onClick={(event) => open(event.currentTarget)}
										className="absolute top-2 right-2 flex size-7 cursor-zoom-in items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100"
									>
										<Maximize2Icon className="size-3.5" />
									</button>
									{item.alt && (
										<span className="truncate border-t px-2.5 py-1.5 text-muted-foreground text-xs">
											{item.alt}
										</span>
									)}
								</span>
							);
						}
						return (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: a run may show one file twice, and it never reorders
								key={at}
								type="button"
								{...{ [ITEM]: JSON.stringify(item) }}
								aria-label={`view ${item.alt || "image"}`}
								onClick={(event) => open(event.currentTarget)}
								className="group/image relative flex min-w-0 max-w-full cursor-zoom-in flex-col overflow-hidden rounded-lg border bg-card text-left text-card-foreground transition-colors hover:border-foreground/25"
							>
								<img
									src={item.url}
									alt={item.alt}
									loading="lazy"
									onLoad={(event) => {
										const { naturalWidth, naturalHeight } = event.currentTarget;
										if (naturalWidth > 0) {
											recordSize(src, `${naturalWidth}×${naturalHeight}`);
										}
									}}
									onError={() => fail(src)}
									className="block h-auto max-h-96 max-w-full bg-white object-contain"
								/>
								<span className="pointer-events-none absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100">
									<Maximize2Icon className="size-3.5" />
								</span>
								{(item.alt || size !== undefined) && (
									<span className="flex w-full items-center justify-between gap-2 border-t px-2.5 py-1.5 text-xs">
										<span className="min-w-0 truncate font-medium text-foreground">
											{item.alt || "Image"}
										</span>
										{size !== undefined && (
											<span className="shrink-0 text-muted-foreground tabular-nums">
												{size}
											</span>
										)}
									</span>
								)}
							</button>
						);
					})}
				</div>
			) : (
				first && (
					<button
						type="button"
						aria-label={
							many ? `view ${title.toLowerCase()}` : `view ${first.alt || kind}`
						}
						onClick={onClick}
						className="my-2 flex w-full max-w-md cursor-pointer items-center gap-3 rounded-lg border bg-card py-2 pr-3 pl-2 text-left text-card-foreground transition-colors hover:bg-muted"
					>
						<span className="flex shrink-0 gap-1">
							{shown.map((item, at) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: a run may show one file twice, and it never reorders
									key={at}
									{...{ [ITEM]: JSON.stringify(item) }}
									className={
										at < THUMBS
											? "relative block size-12 overflow-hidden rounded-md border bg-white"
											: "hidden"
									}
								>
									{at < THUMBS &&
										(item.video ? (
											<video
												src={item.url}
												title={item.alt}
												preload="metadata"
												muted
												onError={() => fail(held[at]?.src ?? "")}
												className="size-full object-cover object-top"
											/>
										) : (
											<img
												src={item.url}
												alt={item.alt}
												loading="lazy"
												onLoad={(event) => {
													const { naturalWidth, naturalHeight } =
														event.currentTarget;
													if (naturalWidth > 0) {
														recordSize(
															held[at]?.src ?? "",
															`${naturalWidth}×${naturalHeight}`,
														);
													}
												}}
												onError={() => fail(held[at]?.src ?? "")}
												className="size-full object-cover object-top"
											/>
										))}
									{at === THUMBS - 1 && shown.length > THUMBS && (
										<span className="absolute inset-0 flex items-center justify-center bg-black/55 font-medium text-sm text-white">
											+{shown.length - THUMBS + 1}
										</span>
									)}
								</span>
							))}
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate font-semibold text-[13.5px]">
								{title}
							</span>
							<span className="truncate text-muted-foreground text-xs">
								{detail}
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-0.5 font-medium text-xs">
							View
							<ChevronRightIcon className="size-3.5" />
						</span>
					</button>
				)
			)}
			{lightbox}
		</>
	);
}

/**
 * The images a paragraph holds when it holds nothing else, read from its
 * children as `isImage` picks them out; `null` when it holds anything more.
 */
export function picturedIn(
	children: ReactNode,
	isImage: (child: {
		type: unknown;
		props: Record<string, unknown>;
	}) => boolean,
): Pictured[] | null {
	const found: Pictured[] = [];
	for (const child of Children.toArray(children)) {
		if (typeof child === "string" && child.trim() === "") {
			continue;
		}
		if (
			!isValidElement<Record<string, unknown>>(child) ||
			!isImage(child) ||
			typeof child.props.src !== "string"
		) {
			return null;
		}
		const alt = child.props.alt;
		found.push({
			src: child.props.src,
			alt: typeof alt === "string" ? alt : "",
		});
	}
	return found.length > 0 ? found : null;
}

/** A line holding one image and nothing else, as Markdown writes it. */
const IMAGE_LINE =
	/^([ \t]*)!\[[^\]\n]*\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)[ \t]*$/;

/**
 * Joins each run of lines that hold one image apiece, blank lines between
 * them allowed, into one line, so the run reads as one paragraph that a
 * renderer draws as one gallery card. Only lines at the same indent join, so
 * an image under one list item never joins one under the next.
 */
export function joinImageRuns(prose: string): string {
	const lines = prose.split("\n");
	const out: string[] = [];
	let run: { indent: string; at: number } | null = null;
	let blanks = 0;
	for (const line of lines) {
		const image = IMAGE_LINE.exec(line);
		if (image && run !== null && image[1] === run.indent) {
			out[run.at] = `${out[run.at]} ${line.trim()}`;
			blanks = 0;
			continue;
		}
		if (line.trim() === "" && run !== null) {
			blanks += 1;
			continue;
		}
		if (blanks > 0) {
			out.push(...Array<string>(blanks).fill(""));
			blanks = 0;
		}
		out.push(line);
		run = image ? { indent: image[1] ?? "", at: out.length - 1 } : null;
	}
	out.push(...Array<string>(blanks).fill(""));
	return out.join("\n");
}

/** An image the page will not load, as its alt text. */
export function Alt({ alt }: { alt?: string }): JSX.Element {
	return <span className="text-muted-foreground">[{alt || "image"}]</span>;
}
