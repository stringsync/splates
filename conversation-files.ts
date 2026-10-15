import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import type { Fs } from "webappwiz/system";
import { textOf } from "./conversation-messages";
import type { Message, Sent, Upload } from "./conversation-state";
import { DICTATED } from "./prompts";
import { mentionLine, Systems, unknownLine } from "./systems";

/**
 * The files the person sent in a conversation, kept beside its log in a
 * directory named for it, and how what they said goes to the agent.
 */
export class ConversationFiles {
	/** Where the files are kept. */
	private readonly dir: string;

	constructor(
		log: string,
		private readonly fs: Fs,
	) {
		this.dir = resolve(log.replace(/\.jsonl$/, ""));
	}

	/**
	 * Saves each file beside the log, named for what is in it, so the page
	 * reads it by name rather than with every change to the conversation.
	 * An image goes to the agent as itself when it `sees` images; anything
	 * else, as a link to where it is kept, which every agent takes.
	 */
	async keep(files: Upload[], sees: boolean): Promise<Sent[]> {
		if (files.length === 0) {
			return [];
		}
		await this.fs.mkdir(this.dir);
		return Promise.all(
			files.map(async ({ title, mimeType, bytes }): Promise<Sent> => {
				const hash = createHash("sha256").update(bytes).digest("hex");
				const seen = sees && mimeType in IMAGE_TYPES;
				const name = `${hash.slice(0, 16)}.${seen ? IMAGE_TYPES[mimeType] : extensionOf(title)}`;
				await this.fs.writeBytes(`${this.dir}/${name}`, bytes);
				return seen
					? { type: "image", name, mimeType }
					: { type: "file", name, title, mimeType };
			}),
		);
	}

	/** The file `name` the person sent in `messages`, or null when they sent none by that name. */
	async attachment(
		name: string,
		messages: Message[],
	): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
		const part = messages
			.flatMap((message) => message.parts)
			.find(
				(each): each is Sent =>
					(each.type === "image" || each.type === "file") && each.name === name,
			);
		if (part === undefined) {
			return null;
		}
		const bytes = await this.fs
			.readBytes(`${this.dir}/${name}`)
			.catch(() => null);
		return bytes === null ? null : { bytes, mimeType: part.mimeType };
	}

	/**
	 * What `messages` say, as one prompt: their images, links to their other
	 * files, then their words, with a line on each system they name in
	 * `tree`, the one the agent runs in (none for a log too old to say), and
	 * one on reading them as speech when any was dictated.
	 */
	async content(
		messages: Message[],
		tree: string | null,
	): Promise<acp.ContentBlock[]> {
		const parts = messages.flatMap((message) => message.parts);
		const images = await Promise.all(
			parts
				.flatMap((part) => (part.type === "image" ? [part] : []))
				.map(
					async (part): Promise<acp.ContentBlock> => ({
						type: "image",
						mimeType: part.mimeType,
						data: Buffer.from(
							await this.fs.readBytes(`${this.dir}/${part.name}`),
						).toString("base64"),
					}),
				),
		);
		const links = parts.flatMap((part): acp.ContentBlock[] =>
			part.type === "file"
				? [
						{
							type: "resource_link",
							uri: pathToFileURL(`${this.dir}/${part.name}`).href,
							name: part.title,
							...(part.mimeType === "" ? {} : { mimeType: part.mimeType }),
						},
					]
				: [],
		);
		const said = messages
			.map(textOf)
			.filter((each) => each !== "")
			.join("\n\n");
		// For the agent alone, as the systems are: the thread shows a mic.
		const dictated = messages.some((each) => each.dictated) ? DICTATED : "";
		const text = [said, await this.systemsIn(said, tree), dictated]
			.filter((each) => each !== "")
			.join("\n\n");
		return [
			...images,
			...links,
			...(text === "" ? [] : [{ type: "text" as const, text }]),
		];
	}

	/** Deletes every file kept, for good. */
	async remove(): Promise<void> {
		await this.fs.rm(this.dir, { recursive: true, force: true });
	}

	/**
	 * A line on each system `text` mentions with `#`, then one on each `#word`
	 * that names none, for the agent alone: the thread keeps the words as
	 * typed. Read from `tree` as it goes, so a system named there a moment
	 * ago counts.
	 */
	private async systemsIn(text: string, tree: string | null): Promise<string> {
		if (tree === null || !text.includes("#")) {
			return "";
		}
		// A config that will not load names none, rather than holding the
		// message back.
		const named = await Systems.at(tree, { fs: this.fs }).catch(() => null);
		if (named === null) {
			return "";
		}
		return [
			...named.mentioned(text).map(mentionLine),
			...named.unknown(text).map(unknownLine),
		].join("\n");
	}
}

/** The images an agent can be sent, by media type, with the extension each is kept under. */
const IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

/**
 * The extension a file the person called `title` is kept under: its own, when
 * it reads as one, so the agent can tell what it holds.
 */
function extensionOf(title: string): string {
	const extension = /\.([a-z0-9]{1,10})$/i.exec(title)?.[1];
	return extension === undefined ? "bin" : extension.toLowerCase();
}
