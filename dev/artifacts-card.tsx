import { ChevronRightIcon, FilesIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { Artifact, ArtifactVersion } from "../artifacts";
import { openArtifact } from "./artifact-open";
import { FileIcon } from "./file-chip";

/**
 * The artifacts a conversation keeps, as a card beside its thread: a row for
 * each it lists, at its current version, opening it. Those it removed and
 * the versions since replaced wait behind a Removed row that expands to
 * them, muted and still opening, at the same indent as the rest. Nothing at
 * all while it keeps none.
 */
export function ArtifactsCard({
	conversation,
	artifacts,
}: {
	/** The conversation's id. */
	conversation: string;
	artifacts: readonly Artifact[];
}): JSX.Element | null {
	const [removed, setRemoved] = useState(false);
	if (artifacts.length === 0) {
		return null;
	}
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
	return (
		<section
			aria-label="artifacts"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<FilesIcon />
				Artifacts
			</h3>
			{listed.length > 0 ? (
				<ul aria-label="listed artifacts">
					{listed.map(({ name, version }) => (
						<ArtifactRow
							key={name}
							conversation={conversation}
							name={name}
							version={version}
						/>
					))}
				</ul>
			) : (
				<p className="px-3 pb-1 text-muted-foreground text-sm">None listed.</p>
			)}
			{hidden.length > 0 && (
				<button
					type="button"
					aria-expanded={removed}
					onClick={() => setRemoved((was) => !was)}
					className="flex h-8 w-full items-center gap-2 px-3 text-left text-muted-foreground text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
				>
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"size-4 shrink-0 transition-transform motion-reduce:transition-none",
							removed && "rotate-90",
						)}
					/>
					<span className="min-w-0 flex-1 truncate">Removed</span>
					<span className="shrink-0 text-xs tabular-nums">{hidden.length}</span>
				</button>
			)}
			{removed && (
				<ul aria-label="removed artifacts" className="text-muted-foreground">
					{hidden.map(({ name, version }) => (
						<ArtifactRow
							key={`${name} ${version.version}`}
							conversation={conversation}
							name={name}
							version={version}
							numbered
						/>
					))}
				</ul>
			)}
		</section>
	);
}

/**
 * One version of an artifact: its type's icon, its name and its size,
 * opening it, or, once its bytes are gone, a placeholder saying when, with
 * nothing to open. `control` stands at its end, for what can be done to the
 * row itself.
 */
function ArtifactRow({
	conversation,
	name,
	version,
	numbered = false,
	control,
}: {
	conversation: string;
	name: string;
	version: ArtifactVersion;
	/** Whether it names its version whatever the number, as one of several does. */
	numbered?: boolean;
	control?: ReactNode;
}): JSX.Element {
	const tag = numbered || version.version > 1 ? `v${version.version}` : null;
	const label = tag === null ? name : `${name} ${tag}`;
	const row = "flex min-h-8 min-w-0 flex-1 items-center gap-2 px-3 text-sm";
	const inside = (
		<>
			<FileIcon
				path={name}
				className={cn("size-4", version.gone !== null && "opacity-50")}
			/>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{name}</span>
				{/* Below the name, so a narrow card cuts it no shorter. */}
				{version.gone !== null && (
					<span className="text-muted-foreground text-xs not-italic">
						{gone(version.gone.at)}
					</span>
				)}
			</span>
			<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
				{tag === null
					? sizeOf(version.bytes)
					: `${tag} · ${sizeOf(version.bytes)}`}
			</span>
		</>
	);
	return (
		<li className="flex min-w-0 items-center">
			{version.gone === null ? (
				<button
					type="button"
					aria-label={label}
					title={`Open ${label}`}
					onClick={() => openArtifact(conversation, name, version.version)}
					className={cn(
						row,
						"text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
					)}
				>
					{inside}
				</button>
			) : (
				<p title={`${label} is gone`} className={cn(row, "italic")}>
					{inside}
				</p>
			)}
			{control}
		</li>
	);
}

/** When a version's bytes went: `gone 3d ago`, or `gone just now`. */
function gone(at: string): string {
	const ago = age(at);
	return ago === "0m" ? "gone just now" : `gone ${ago} ago`;
}

/** `bytes` at the coarsest unit that still reads: `512 B`, `12 KB`, `1.4 MB`. */
export function sizeOf(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
