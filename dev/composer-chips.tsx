import type {
	TriggerItem,
	Unstable_DirectiveFormatter,
} from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import { LoaderCircleIcon } from "lucide-react";
import { createContext, type JSX, use } from "react";
import { DIRECTIVES } from "../prompts";
import {
	ATTACHMENT_REFERENCE,
	attachmentNumber,
	shelfOf,
} from "./attachment-chips";
import { AttachmentMenu } from "./attachment-menu";
import { DirectiveChip } from "./directives";
import {
	NAMING,
	type Named,
	NamedChip,
	NamedContext,
	reading,
	untrailed,
} from "./mentioned";

/**
 * A reference as the agent reads it: `@path` for a file, `#name` for a
 * system, `/name` for a command, `[Image 2]` or `[File 1]` for an attachment,
 * and an `[ARBOR ...]` directive as itself.
 */
export function serialize(item: TriggerItem): string {
	if (item.type === "attachment") {
		return `[${item.id}]`;
	}
	const sign = { file: "@", system: "#", command: "/" }[item.type] ?? "";
	return `${sign}${item.id}`;
}
/**
 * An `[ARBOR ...]` directive, a `#` or `@` reference, or an attachment's
 * `[Image 2]` or `[File 1]`, in a line.
 */
const REFERENCES = new RegExp(
	`${DIRECTIVES.source}|${NAMING.source}|${ATTACHMENT_REFERENCE.source}`,
	"gu",
);
/** What a system's name could be, for a `#` read before the systems come. */
const NAME = /^\p{L}[\p{L}\p{N}_-]*$/u;
/**
 * Reads the `[ARBOR ...]` directives, and the `@path` and `#system`
 * references, in a line of the composer's text, set from outside it, as a
 * draft or a prompt is, into chips. A directive or an attachment is always one; a
 * reference
 * that names a path or system of `named` is a chip, and so is any while what it
 * could name is still on its way, for its chip to resolve; one that names
 * nothing, such as `#12`, stays text.
 */
export function chipFormatter(named: Named): Unstable_DirectiveFormatter {
	/** What `called` reads as after `sign`, if it is a chip. */
	const chipped = (sign: string, called: string): string | undefined => {
		const resolving =
			sign === "@" ? named.resolving.paths : named.resolving.systems;
		if (!resolving) {
			return reading(named, sign, called)?.as;
		}
		const as = untrailed(called);
		return sign === "@" || NAME.test(as) ? as : undefined;
	};
	return {
		serialize,
		parse: (text) => {
			const segments: Segment[] = [];
			let at = 0;
			for (const found of text.matchAll(REFERENCES)) {
				const [whole, before = "", sign, called = "", attachment] = found;
				if (attachment !== undefined) {
					if (found.index > at) {
						segments.push({ kind: "text", text: text.slice(at, found.index) });
					}
					segments.push({
						kind: "mention",
						type: "attachment",
						id: attachment,
						label: attachment,
					});
					at = found.index + whole.length;
					continue;
				}
				const as = sign === undefined ? whole : chipped(sign, called);
				if (as === undefined) {
					continue;
				}
				const start = found.index + before.length;
				if (start > at) {
					segments.push({ kind: "text", text: text.slice(at, start) });
				}
				segments.push({
					kind: "mention",
					type:
						sign === undefined ? "directive" : sign === "@" ? "file" : "system",
					id: as,
					label: as,
				});
				at = start + (sign?.length ?? 0) + as.length;
			}
			if (at < text.length || segments.length === 0) {
				segments.push({ kind: "text", text: text.slice(at) });
			}
			return segments;
		},
	};
}
type Segment = ReturnType<Unstable_DirectiveFormatter["parse"]>[number];
/**
 * What each file or directory the composer names is called on its chip, told
 * apart from the others there.
 */
export const FileNames = createContext<ReadonlyMap<string, string>>(new Map());
/**
 * A reference in the composer, drawn as a message draws it: a file or system
 * chip, "Resolving…" while the paths or systems it could name are on their
 * way, and as it was written once they came without it. It sits in a box one
 * line of the composer's text tall, so a chip never makes its line taller.
 */
export function ComposerChip(props: DirectiveChipProps): JSX.Element {
	return (
		<span className="inline-flex h-lh items-center align-top">
			<Chip {...props} />
		</span>
	);
}
function Chip({
	directiveId,
	directiveType,
	label,
}: DirectiveChipProps): JSX.Element {
	const named = use(NamedContext);
	if (directiveType === "directive") {
		return <DirectiveChip directive={directiveId} inline />;
	}
	if (directiveType === "command") {
		return <span className={CHIP}>/{label}</span>;
	}
	if (directiveType === "attachment") {
		return <AttachedChip name={directiveId} />;
	}
	const file = directiveType === "file";
	if (file ? named.resolving.paths : named.resolving.systems) {
		return (
			<span
				title={serialize({ id: directiveId, type: directiveType, label })}
				className={`${CHIP} text-muted-foreground`}
			>
				<LoaderCircleIcon
					aria-hidden
					className="size-3 shrink-0 animate-spin"
				/>
				Resolving…
			</span>
		);
	}
	const names = use(FileNames);
	const found = reading(named, file ? "@" : "#", directiveId)?.target;
	if (found === undefined) {
		return (
			<span>{serialize({ id: directiveId, type: directiveType, label })}</span>
		);
	}
	return (
		<NamedChip
			named={file ? { file: found, name: names.get(found) } : { system: found }}
		/>
	);
}
/**
 * An attachment's chip; as it was written, once what it names is no longer
 * attached, as after a draft comes back without its attachments.
 */
function AttachedChip({ name }: { name: string }): JSX.Element {
	const placed = attachmentNumber(name);
	const attached = useAuiState(
		(state) =>
			state.composer.attachments.filter(
				(each) => shelfOf(each.type) === placed?.shelf,
			).length,
	);
	if (placed === null || placed.at > attached) {
		return <span>[{name}]</span>;
	}
	return <AttachmentMenu placed={placed} />;
}
const CHIP =
	"inline-flex h-6 items-center gap-1 rounded-md border px-1.5 align-middle font-mono text-xs";
