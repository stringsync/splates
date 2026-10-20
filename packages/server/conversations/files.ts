import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import { DICTATED } from "../plans";
import { projectLine } from "../projects";
import type { Collection, Storage } from "../storage";
import type { ProjectRoster } from "./host";
import { textOf } from "./messages";
import { conversationReference } from "./reference";
import type { Message, Sent, Upload } from "./state";
import { transcriptOf } from "./transcript";

/**
 * The files the person sent in a conversation, kept beside its log in a
 * collection named for it, and how what they said goes to the agent.
 */
export class ConversationFiles {
	private readonly files: Collection;
	private readonly projects: ProjectRoster | null;
	private readonly home: string | null;

	constructor(
		/**
		 * Where the conversations are kept, each log `<id>.jsonl`, which an
		 * agent opens what it is handed from as files on this machine.
		 */
		private readonly storage: Storage,
		private readonly id: string,
		{
			projects = null,
			home = null,
		}: {
			/** The splates projects on this machine, for `#slug`; null for none. */
			projects?: ProjectRoster | null;
			/** The main tree of the project the conversation is in; null for none. */
			home?: string | null;
		} = {},
	) {
		this.files = storage.collection(id);
		this.projects = projects;
		this.home = home;
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
		return Promise.all(
			files.map(async ({ title, mimeType, bytes }): Promise<Sent> => {
				const hash = createHash("sha256").update(bytes).digest("hex");
				const seen = sees && mimeType in IMAGE_TYPES;
				const name = `${hash.slice(0, 16)}.${seen ? IMAGE_TYPES[mimeType] : extensionOf(title)}`;
				await this.files.writeBytes(name, bytes);
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
		const bytes = await this.files.readBytes(name).catch(() => null);
		return bytes === null ? null : { bytes, mimeType: part.mimeType };
	}

	/**
	 * What `messages` say, as one prompt: their images, links to their other
	 * files, then their words, with a line on where each project they name
	 * sits, and one on reading them as speech
	 * when any was dictated.
	 */
	async content(
		messages: Message[],
		sees = false,
	): Promise<acp.ContentBlock[]> {
		// Uploads queued before initialization are files until capabilities are
		// known. Image-capable agents still receive those as image blocks.
		const parts = messages
			.flatMap((message) => message.parts)
			.map((part) =>
				part.type === "file" && sees && part.mimeType in IMAGE_TYPES
					? { ...part, type: "image" as const }
					: part,
			);
		const images = await Promise.all(
			parts
				.flatMap((part) => (part.type === "image" ? [part] : []))
				.map(
					async (part): Promise<acp.ContentBlock> => ({
						type: "image",
						mimeType: part.mimeType,
						data: Buffer.from(await this.bytesOf(part.name)).toString("base64"),
					}),
				),
		);
		const links = await Promise.all(
			parts
				.flatMap((part) => (part.type === "file" ? [part] : []))
				.map(
					async (part): Promise<acp.ContentBlock> => ({
						type: "resource_link",
						uri: pathToFileURL(await this.opened(part.name)).href,
						name: part.title,
						...(part.mimeType === "" ? {} : { mimeType: part.mimeType }),
					}),
				),
		);
		const said = messages
			.map(textOf)
			.filter((each) => each !== "")
			.join("\n\n");
		// The thread shows a mic; the agent needs the dictation instruction.
		const dictated = messages.some((each) => each.dictated) ? DICTATED : "";
		const text = [said, await this.namedIn(said), dictated]
			.filter((each) => each !== "")
			.join("\n\n");
		return [
			...images,
			...links,
			...(text === "" ? [] : [{ type: "text" as const, text }]),
		];
	}

	/**
	 * Writes the end of `messages` beside the log for the agent that takes its
	 * task on next, and answers where (see `transcriptOf`).
	 */
	async keepTranscript(messages: Message[]): Promise<string> {
		await this.files.write("transcript.md", `${transcriptOf(messages)}\n`);
		return this.opened("transcript.md");
	}

	/** Deletes every file kept, for good. */
	async remove(): Promise<void> {
		await this.files.clear();
	}

	/** Where an agent on this machine opens the file kept under `name`. */
	private opened(name: string): Promise<string> {
		return this.storage.materialize(`${this.id}/${name}`);
	}

	/** The bytes kept under `name`, throwing when there are none. */
	private async bytesOf(name: string): Promise<Uint8Array> {
		const bytes = await this.files.readBytes(name);
		if (bytes === null) {
			throw new Error(`no file ${name} in ${this.files.key}`);
		}
		return bytes;
	}

	/** Adds project locations and conversation log references for the agent. */
	private async namedIn(text: string): Promise<string> {
		if (!text.includes("#")) {
			return "";
		}
		const listed = (await this.projects?.list().catch(() => null)) ?? [];
		const projects = listed.filter((each) => !each.gone);
		const conversations = hashed(text).filter(conversationReference);
		const found = hashed(text).flatMap((called) => {
			const project = projects.find((each) => each.slug === called);
			return project === undefined ? [] : [project];
		});
		return [
			...(await Promise.all(
				conversations.map(
					async (id) =>
						`#${id} references conversation ${id}. Its log is ${await this.storage.materialize(`${id}.jsonl`)}.`,
				),
			)),
			...(await Promise.all(
				found.map(async (project) =>
					projectLine({
						...project,
						reach:
							this.home === null || project.root === this.home
								? null
								: ((await this.projects?.reach(this.home, project.root)) ??
									null),
					}),
				),
			)),
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

/** Each #word outside code, once, in the order first mentioned. */
function hashed(text: string): string[] {
	const prose = text.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, " ");
	return [
		...new Set(
			[...prose.matchAll(/(^|\s)#([^\s#]*[^\s#.,;:!?)\]'"-])/g)].map(
				(match) => match[2] ?? "",
			),
		),
	];
}
