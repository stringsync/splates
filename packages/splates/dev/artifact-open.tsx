import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import {
	createContext,
	type JSX,
	type ReactNode,
	useContext,
	useState,
} from "react";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import { Dialog, DialogContent } from "#dev/components/ui/dialog.tsx";
import { viewerOf } from "../artifact-viewers";
import type { Artifact, ArtifactVersion } from "../artifacts";
import { conversationArtifact } from "./conversation-api";
import { type Shown, useLightbox } from "./lightbox";

/** Opens `version` of the artifact `name` of conversation `conversation`. */
export type OpenArtifact = (
	conversation: string,
	name: string,
	version: number,
) => void;

const Opening = createContext<OpenArtifact | null>(null);

/**
 * What opens an artifact from its row beside the thread or its chip in a
 * line: the viewer of the conversation it sits in, or, outside one, a
 * download under its name.
 */
export function useOpenArtifact(): OpenArtifact {
	return useContext(Opening) ?? download;
}

/**
 * Opens the artifacts of the conversation `conversation`, for `children`, by
 * what they are: an image or a recording in the lightbox, among the others
 * of the shelf it sits on beside the thread; a page in a sandboxed frame;
 * anything else as a download. A version whose bytes are gone opens nothing.
 * An artifact of another conversation, or one the page has yet to hear of,
 * downloads.
 */
export function ArtifactViewer({
	conversation,
	artifacts,
	children,
}: {
	/** The conversation's id. */
	conversation: string;
	artifacts: readonly Artifact[];
	children: ReactNode;
}): JSX.Element {
	const { show, lightbox } = useLightbox();
	const [page, setPage] = useState<Shown | null>(null);
	const open: OpenArtifact = (from, name, version) => {
		const kept = artifacts
			.find((each) => each.name === name)
			?.versions.find((each) => each.version === version);
		if (from !== conversation || kept === undefined) {
			download(from, name, version);
			return;
		}
		if (kept.gone !== null) {
			return;
		}
		const viewer = viewerOf(kept.mimeType);
		if (viewer === null) {
			download(from, name, version);
			return;
		}
		const { listed, hidden } = shelves(artifacts);
		const onListed = listed.some((each) => each.version === kept);
		if (viewer === "page") {
			setPage(shown(conversation, { name, version: kept }, !onListed));
			return;
		}
		const media = (onListed ? listed : hidden).filter((each) => {
			const kind = viewerOf(each.version.mimeType);
			return (
				each.version.gone === null && (kind === "image" || kind === "video")
			);
		});
		show(
			media.map((each) => shown(conversation, each, !onListed)),
			media.findIndex((each) => each.version === kept),
		);
	};
	return (
		<Opening.Provider value={open}>
			{children}
			{lightbox}
			<PageViewer page={page} onClose={() => setPage(null)} />
		</Opening.Provider>
	);
}

/** One version of an artifact, by its name. */
export interface Shelved {
	name: string;
	version: ArtifactVersion;
}

/**
 * The artifacts beside the thread: `listed`, each still listed at its current
 * version, and `hidden`, the versions of those removed and those since
 * replaced, newest first, behind the Removed row.
 */
export function shelves(artifacts: readonly Artifact[]): {
	listed: Shelved[];
	hidden: Shelved[];
} {
	const listed = artifacts.flatMap((artifact) => {
		const version = artifact.versions.find(
			(each) => each.version === artifact.current,
		);
		return artifact.removedAt === null && version !== undefined
			? [{ name: artifact.name, version }]
			: [];
	});
	const hidden = artifacts.flatMap((artifact) =>
		artifact.versions
			.filter(
				(each) =>
					artifact.removedAt !== null || each.version !== artifact.current,
			)
			.reverse()
			.map((version) => ({ name: artifact.name, version })),
	);
	return { listed, hidden };
}

/**
 * How a version is named where it shows: `report.html`, or `report.html v2`
 * for a later one, or for any behind the Removed row, `numbered`.
 */
export function labelOf(
	name: string,
	version: number,
	numbered: boolean,
): string {
	return numbered || version > 1 ? `${name} v${version}` : name;
}

function shown(
	conversation: string,
	{ name, version }: Shelved,
	numbered: boolean,
): Shown {
	return {
		url: conversationArtifact(conversation, name, version.version),
		alt: labelOf(name, version.version, numbered),
		video: viewerOf(version.mimeType) === "video",
		name,
	};
}

/**
 * A page an agent made, in a frame over the thread at nearly the size of the
 * window. The frame lets it run its scripts and nothing more: no origin of
 * the page's, so none of its cookies, storage or DOM, and no forms, popups
 * or navigating the page away. The route's own policy keeps it from the
 * network, so it is a single file.
 */
function PageViewer({
	page,
	onClose,
}: {
	page: Shown | null;
	onClose: () => void;
}): JSX.Element {
	return (
		<Dialog
			open={page !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)]"
			>
				{page !== null && (
					<>
						<div className="flex h-10 shrink-0 items-center gap-1 border-b pr-1 pl-3">
							<DialogPrimitive.Title className="min-w-0 flex-1 truncate font-medium text-sm">
								{page.alt}
							</DialogPrimitive.Title>
							<a
								href={page.url}
								target="_blank"
								rel="noreferrer"
								aria-label="open in a new tab"
								className={buttonVariants({
									variant: "ghost",
									size: "icon-sm",
								})}
							>
								<ExternalLinkIcon />
							</a>
							<DialogPrimitive.Close
								render={
									<Button variant="ghost" size="icon-sm" aria-label="close" />
								}
							>
								<XIcon />
							</DialogPrimitive.Close>
						</div>
						<iframe
							key={page.url}
							src={page.url}
							title={page.alt}
							sandbox="allow-scripts"
							referrerPolicy="no-referrer"
							className="min-h-0 w-full flex-1 bg-white"
						/>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/** Downloads a version of an artifact, under its name. */
function download(conversation: string, name: string, version: number): void {
	const link = document.createElement("a");
	link.href = conversationArtifact(conversation, name, version);
	link.download = name;
	link.click();
}
