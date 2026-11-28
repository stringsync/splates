import { age } from "@splates/server/age";
import type { ArtifactGone } from "@splates/server/artifacts";
import {
	AppWindowIcon,
	ChevronRightIcon,
	ChevronUpIcon,
	ExternalLinkIcon,
	Maximize2Icon,
	ShieldCheckIcon,
} from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { labelOf, useArtifactVersion, useOpenArtifact } from "./artifact-open";
import { sizeOf } from "./artifacts-card";
import { CardShell } from "./card-shell";
import { conversationArtifact } from "./conversation-api";
import { useImagePreviewsExpanded } from "./image-previews";

/** Minimum height for an expanded inline HTML artifact frame. */
const MIN_FRAME_HEIGHT = 180;
/** Maximum height for an expanded inline HTML artifact frame. */
const MAX_FRAME_HEIGHT = 480;
/** Default height before the framed document reports its own height. */
const DEFAULT_FRAME_HEIGHT = 360;

/**
 * Renders an HTML artifact inline in a conversation thread. When the
 * conversation's inline previews are collapsed (the default), it draws a
 * single-line clickable bar with zero iframes mounted and opens fullscreen on
 * tap. When expanded, it draws a framed sandboxed iframe with labelled
 * Collapse, New tab, and Fullscreen footer controls.
 */
export function InlineHtmlArtifact({
	conversation,
	name,
	version,
	alt,
	bytes,
}: {
	conversation?: string;
	name: string;
	version: number;
	/** Optional Markdown caption used as a fallback title when the HTML lacks `<title>`. */
	alt?: string;
	/** Optional size fallback from the event before artifact state loads. */
	bytes?: number;
}): JSX.Element {
	const info = useArtifactVersion(name, version);
	const open = useOpenArtifact();
	const policyExpanded = useImagePreviewsExpanded();
	const [override, setOverride] = useState<boolean | null>(null);
	const [prevPolicy, setPrevPolicy] = useState(policyExpanded);
	if (prevPolicy !== policyExpanded) {
		setPrevPolicy(policyExpanded);
		setOverride(null);
	}
	const expanded = override ?? policyExpanded;

	const frameRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(DEFAULT_FRAME_HEIGHT);

	const conv = conversation || info?.conversation || "";
	const kept = info?.version;
	const gone = kept?.gone ?? null;
	const byteCount = kept?.bytes ?? bytes;
	const displayTitle = kept?.title || alt || name;
	const label = labelOf(name, version, false);
	const versionTag = version > 1 ? `v${version}` : null;
	const sizeTag = byteCount !== undefined ? sizeOf(byteCount) : null;
	const barMeta = [versionTag, sizeTag].filter(Boolean).join(" · ");
	const headerMeta = [displayTitle !== name ? name : null, versionTag, sizeTag]
		.filter(Boolean)
		.join(" · ");
	const url = conv === "" ? "" : conversationArtifact(conv, name, version);

	useEffect(() => {
		if (!expanded || gone !== null) {
			return;
		}
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frameRef.current?.contentWindow) {
				return;
			}
			const data = event.data as {
				splates?: unknown;
				height?: unknown;
			} | null;
			if (
				data?.splates !== "frame-height" ||
				typeof data.height !== "number" ||
				!Number.isFinite(data.height) ||
				data.height <= 0
			) {
				return;
			}
			const clamped = Math.max(
				MIN_FRAME_HEIGHT,
				Math.min(MAX_FRAME_HEIGHT, Math.ceil(data.height)),
			);
			setHeight(clamped);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [expanded, gone]);

	if (gone !== null) {
		return (
			// vet-ignore splates-conversation-card: unavailable artifact status bar preserves data-card selector
			<div
				role="status"
				aria-label={`${label} unavailable`}
				data-card
				data-slot="inline-artifact"
				className="my-3 flex min-h-[46px] w-full items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2 text-muted-foreground text-sm italic shadow-xs"
			>
				<AppWindowIcon aria-hidden className="size-4 shrink-0 opacity-50" />
				<span className="min-w-0 flex-1 truncate">{displayTitle}</span>
				<span className="shrink-0 text-xs not-italic">{goneText(gone)}</span>
			</div>
		);
	}

	if (!expanded) {
		return (
			<button
				type="button"
				data-slot="inline-artifact"
				aria-label={`Open ${label}`}
				title={`Open ${label}`}
				onClick={() => open(conv, name, version)}
				className="my-3 flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-card py-2 pr-2 pl-3.5 text-left text-[13.5px] text-card-foreground shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<AppWindowIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
					<span className="truncate font-medium">{displayTitle}</span>
					{barMeta !== "" && (
						<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
							{barMeta}
						</span>
					)}
				</span>
				<span className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-2 font-medium text-muted-foreground text-xs">
					Open
					<ChevronRightIcon aria-hidden className="size-3.5 opacity-70" />
				</span>
			</button>
		);
	}

	return (
		<CardShell
			label={label}
			Icon={AppWindowIcon}
			title={displayTitle}
			tone="neutral"
			centerHeader
			ringed={false}
			aside={
				headerMeta === "" ? undefined : (
					<span className="text-muted-foreground text-xs tabular-nums">
						{headerMeta}
					</span>
				)
			}
		>
			<iframe
				ref={frameRef}
				key={url}
				src={url}
				title={label}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				loading="lazy"
				style={{ height: `${height}px` }}
				className="block max-h-[480px] @max-md:max-h-[360px] w-full border-0 bg-white"
			/>
			{
				// vet-ignore splates-conversation-card: iframe footer includes an external target="_blank" link that CardFooter actions do not model
				<footer className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-2.5">
					<span className="mr-auto flex items-center gap-1.5 text-muted-foreground text-xs @max-md:hidden">
						<ShieldCheckIcon aria-hidden className="size-3.5" />
						Sandboxed frame
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setOverride(false)}
					>
						<ChevronUpIcon />
						Collapse
					</Button>
					<a
						href={url}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<ExternalLinkIcon />
						New tab
					</a>
					<Button
						type="button"
						variant="default"
						size="sm"
						onClick={() => open(conv, name, version)}
					>
						<Maximize2Icon />
						Fullscreen
					</Button>
				</footer>
			}
		</CardShell>
	);
}

const GONE: Record<ArtifactGone, string> = {
	archived: "removed on archive",
	evicted: "evicted for space",
	deleted: "deleted by you",
};

function goneText({ at, why }: { at: string; why: ArtifactGone }): string {
	const ago = age(at);
	return `${GONE[why]} ${ago === "0m" ? "just now" : `${ago} ago`}`;
}
