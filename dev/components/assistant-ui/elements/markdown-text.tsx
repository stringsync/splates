"use client";

import type { TextMessagePartProps } from "@assistant-ui/react";
import {
	type CodeHeaderProps,
	MarkdownTextPrimitive,
	unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
	useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type FC, type JSX, memo, useContext, useMemo, useRef } from "react";
import remarkGfm from "remark-gfm";
import { attachmentIn } from "#dev/attachment-chips.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { DirectiveChip, directiveIn } from "#dev/directives.tsx";
import { useCopyToClipboard } from "#dev/hooks/use-copy-to-clipboard.ts";
import { cn } from "#dev/lib/utils.ts";
import { GROUP } from "#dev/lightbox.tsx";
import {
	linkMentions,
	linkTasks,
	Mention,
	mentionIn,
	taskIn,
} from "#dev/markdown.tsx";
import { Media } from "#dev/media.tsx";
import {
	linkNamed,
	NamedChip,
	NamedContext,
	namedIn,
} from "#dev/mentioned.tsx";
import { TaskChip } from "#dev/reference-chip.tsx";
import { SentAttachmentChip } from "#dev/sent-attachments.tsx";

export const MarkdownText = memo(MarkdownTextImpl);

type MarkdownTextProps = Partial<TextMessagePartProps> & {
	components?: Parameters<typeof memoizeMarkdownComponents>[0];
	/**
	 * What the person typed rather than what an agent wrote: each line break
	 * kept as typed, and the text `typed` keeps of it, such as all but its
	 * directives, revealed at once rather than streamed in.
	 */
	typed?: (text: string) => string;
};

function useShallowStable<T extends Record<string, unknown> | undefined>(
	value: T,
): T {
	const ref = useRef(value);
	if (value !== ref.current) {
		const prev = ref.current;
		const stable =
			value !== undefined &&
			prev !== undefined &&
			Object.keys(prev).length === Object.keys(value).length &&
			Object.keys(value).every((key) => prev[key] === value[key]);
		if (!stable) {
			ref.current = value;
		}
	}
	return ref.current;
}

function MarkdownTextImpl({
	components,
	typed,
}: MarkdownTextProps): JSX.Element {
	const stableComponents = useShallowStable(components);
	const named = useContext(NamedContext);
	const markdownComponents = useMemo(() => {
		if (!stableComponents) {
			return defaultComponents;
		}
		return {
			...defaultComponents,
			...memoizeMarkdownComponents(stableComponents),
		};
	}, [stableComponents]);

	// The lightbox steps through the screenshots of one message.
	return (
		<div {...{ [GROUP]: "" }}>
			<MarkdownTextPrimitive
				remarkPlugins={typed ? TYPED_PLUGINS : PLUGINS}
				// Each `#N` a link to that todo, which `a` draws as a mention, and
				// each system, path and task the page names one `a` draws as its
				// chip.
				preprocess={(text: string) =>
					linkMentions(linkNamed(linkTasks(typed ? typed(text) : text), named))
				}
				className="aui-md"
				components={markdownComponents}
				smooth={typed === undefined}
				defer
			/>
		</div>
	);
}

/** The shape of the mdast nodes `keepBreaks` reads and writes. */
interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
}

/**
 * A remark plugin keeping each line break within a paragraph as a break, as
 * a message box shows what was typed, where markdown would join the lines.
 */
const keepBreaks = () => (tree: MdNode) => {
	const visit = (node: MdNode) => {
		if (node.children === undefined) {
			return;
		}
		node.children = node.children.flatMap((child) => {
			if (child.type !== "text" || !child.value?.includes("\n")) {
				visit(child);
				return [child];
			}
			return child.value
				.split(/\r?\n/)
				.flatMap((line, at): MdNode[] => [
					...(at > 0 ? [{ type: "break" }] : []),
					...(line === "" ? [] : [{ type: "text", value: line }]),
				]);
		});
	};
	visit(tree);
};

const PLUGINS = [remarkGfm];
const TYPED_PLUGINS = [remarkGfm, keepBreaks];

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
	const { isCopied, copyToClipboard } = useCopyToClipboard();
	const onCopy = () => {
		if (!code || isCopied) {
			return;
		}
		copyToClipboard(code);
	};

	return (
		<div className="aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs">
			<span className="aui-code-header-language text-muted-foreground font-medium lowercase">
				{language}
			</span>
			<TooltipIconButton tooltip="Copy" onClick={onCopy}>
				{!isCopied && (
					<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
				)}
				{isCopied && (
					<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
				)}
			</TooltipIconButton>
		</div>
	);
};

const defaultComponents = memoizeMarkdownComponents({
	// What an agent attached shows inline; any other path reads as its alt text.
	img: ({ src, alt }) => (
		<Media src={typeof src === "string" ? src : undefined} alt={alt} />
	),
	h1: ({ className, ...props }) => (
		<h1
			className={cn(
				"aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h2: ({ className, ...props }) => (
		<h2
			className={cn(
				"aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h3: ({ className, ...props }) => (
		<h3
			className={cn(
				"aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h4: ({ className, ...props }) => (
		<h4
			className={cn(
				"aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h5: ({ className, ...props }) => (
		<h5
			className={cn(
				"aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	h6: ({ className, ...props }) => (
		<h6
			className={cn(
				"aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	p: ({ className, ...props }) => (
		<p
			className={cn(
				"aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	// A link opens in a new tab, so the conversation keeps its place; one to a
	// spot on the page, such as a footnote, stays in it. A todo's opens it over
	// the conversation, and a system or file a person named shows as its chip.
	a: ({ className, ...props }) => {
		const mention = mentionIn(props.href);
		if (mention !== null) {
			return <Mention id={mention} />;
		}
		const named = namedIn(props.href);
		if (named !== null) {
			return <NamedChip named={named} />;
		}
		const directive = directiveIn(props.href);
		if (directive !== null) {
			return <DirectiveChip directive={directive} opens inline />;
		}
		const task = taskIn(props.href);
		if (task !== null) {
			return <TaskChip task={task} inline />;
		}
		const attachment = attachmentIn(props.href);
		if (attachment !== null) {
			return <SentAttachmentChip placed={attachment} />;
		}
		return (
			<a
				className={cn(
					"aui-md-a text-blue-600 hover:text-blue-600/80 dark:text-blue-400 dark:hover:text-blue-400/80 underline underline-offset-2",
					className,
				)}
				{...(props.href?.startsWith("#")
					? {}
					: { target: "_blank", rel: "noreferrer noopener" })}
				{...props}
			/>
		);
	},
	blockquote: ({ className, ...props }) => (
		<blockquote
			className={cn(
				"aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-3 border-s-2 ps-4 first:mt-0 last:mb-0",
				className,
			)}
			{...props}
		/>
	),
	ul: ({ className, ...props }) => (
		<ul
			className={cn(
				"aui-md-ul marker:text-muted-foreground my-3 ms-5 list-disc first:mt-0 last:mb-0 [&>li]:mt-1",
				className,
			)}
			{...props}
		/>
	),
	ol: ({ className, ...props }) => (
		<ol
			className={cn(
				"aui-md-ol marker:text-muted-foreground my-3 ms-5 list-decimal first:mt-0 last:mb-0 [&>li]:mt-1",
				className,
			)}
			{...props}
		/>
	),
	hr: ({ className, ...props }) => (
		<hr
			className={cn("aui-md-hr border-muted-foreground/20 my-3", className)}
			{...props}
		/>
	),
	table: ({ className, ...props }) => (
		<div className="aui-md-table-wrapper my-3 overflow-x-auto first:mt-0 last:mb-0">
			<table
				className={cn(
					"aui-md-table w-full border-separate border-spacing-0",
					className,
				)}
				{...props}
			/>
		</div>
	),
	th: ({ className, ...props }) => (
		<th
			className={cn(
				"aui-md-th bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	td: ({ className, ...props }) => (
		<td
			className={cn(
				"aui-md-td border-muted-foreground/20 border-s border-b px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right",
				className,
			)}
			{...props}
		/>
	),
	tr: ({ className, ...props }) => (
		<tr
			className={cn(
				"aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
				className,
			)}
			{...props}
		/>
	),
	li: ({ className, ...props }) => (
		<li className={cn("aui-md-li leading-relaxed", className)} {...props} />
	),
	strong: ({ className, ...props }) => (
		<strong
			className={cn("aui-md-strong font-semibold", className)}
			{...props}
		/>
	),
	sup: ({ className, ...props }) => (
		<sup
			className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
			{...props}
		/>
	),
	pre: ({ className, ...props }) => (
		<pre
			className={cn(
				"aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
				className,
			)}
			{...props}
		/>
	),
	code: function Code({ className, ...props }) {
		const isCodeBlock = useIsMarkdownCodeBlock();
		return (
			<code
				className={cn(
					!isCodeBlock &&
						"aui-md-inline-code bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
					className,
				)}
				{...props}
			/>
		);
	},
	CodeHeader,
});
