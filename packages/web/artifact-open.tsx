import type { Artifact, ArtifactVersion } from "@splates/server/artifacts";
import { viewerOf } from "@splates/server/artifacts/browser";
import { createContext, type JSX, type ReactNode, useContext } from "react";
import { conversationArtifact } from "./conversation-api";
import { type Shown, useLightbox } from "./lightbox";

/** Opens `version` of the artifact `name` of conversation `conversation`. */
export type OpenArtifact = (
	conversation: string,
	name: string,
	version: number,
) => void;

const Opening = createContext<OpenArtifact | null>(null);

const HeldArtifacts = createContext<{
	conversation: string;
	artifacts: readonly Artifact[];
} | null>(null);

/**
 * What opens an artifact from its row beside the thread or its chip in a
 * line: the viewer of the conversation it sits in, or, outside one, a
 * download under its name.
 */
export function useOpenArtifact(): OpenArtifact {
	return useContext(Opening) ?? download;
}

/**
 * Looks up `version` of artifact `name` inside the current conversation's
 * `ArtifactViewer`, or returns null when rendered outside one.
 */
export function useArtifactVersion(
	name: string,
	version: number,
): {
	conversation: string;
	artifact: Artifact | undefined;
	version: ArtifactVersion | undefined;
} | null {
	const held = useContext(HeldArtifacts);
	if (held === null) {
		return null;
	}
	const artifact = held.artifacts.find((each) => each.name === name);
	const kept = artifact?.versions.find((each) => each.version === version);
	return { conversation: held.conversation, artifact, version: kept };
}

/**
 * Wrap a conversation's thread in it so its artifacts open where they are
 * clicked: images, recordings, and HTML pages together in the unified
 * lightbox, and the rest as downloads.
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
		const viewable = (onListed ? listed : hidden).filter(
			(each) =>
				each.version.gone === null && viewerOf(each.version.mimeType) !== null,
		);
		show(
			viewable.map((each) => shown(conversation, each, !onListed)),
			viewable.findIndex((each) => each.version === kept),
		);
	};
	return (
		<HeldArtifacts.Provider value={{ conversation, artifacts }}>
			<Opening.Provider value={open}>
				{children}
				{lightbox}
			</Opening.Provider>
		</HeldArtifacts.Provider>
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
	const viewer = viewerOf(version.mimeType);
	return {
		url: conversationArtifact(conversation, name, version.version),
		alt: labelOf(name, version.version, numbered),
		video: viewer === "video",
		html: viewer === "page",
		name,
	};
}

/** Downloads a version of an artifact, under its name. */
function download(conversation: string, name: string, version: number): void {
	const link = document.createElement("a");
	link.href = conversationArtifact(conversation, name, version);
	link.download = name;
	link.click();
}
