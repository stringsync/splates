import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import type { Fs } from "webappwiz/system";
import type { ProjectRoster } from "./conversation-host";
import { textOf } from "./conversation-messages";
import type { Message, Sent, Upload } from "./conversation-state";
import { projectLine } from "./projects";
import { DICTATED } from "./prompts";
import { hashed, mentionLine, Systems, unknownLine } from "./systems";

/**
 * The files the person sent in a conversation, kept beside its log in a
 * directory named for it, and how what they said goes to the agent.
 */
export class ConversationFiles {
	/** Where the files are kept. */
	private readonly dir: string;
	private readonly projects: ProjectRoster | null;
	private readonly home: string | null;

	constructor(
		log: string,
		private readonly fs: Fs,
		{
			projects = null,
			home = null,
		}: {
			/** The arbor projects on this machine, for `#slug`; null for none. */
			projects?: ProjectRoster | null;
			/** The main tree of the project the conversation is in; null for none. */
			home?: string | null;
		} = {},
	) {
		this.dir = resolve(log.replace(/\.jsonl$/, ""));
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
	 * `tree`, the one the agent runs in (none for a log too old to say), one
	 * on where each project they name sits, and one on reading them as speech
	 * when any was dictated.
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
		const text = [said, await this.namedIn(said, tree), dictated]
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
	 * A line on each system `text` mentions with `#`, then on each project,
	 * then one on each `#word` that names neither, for the agent alone: the
	 * thread keeps the words as typed. Read from `tree` and the projects as
	 * it goes, so a system named there a moment ago counts. A system wins
	 * over a project of the same name.
	 */
	private async namedIn(text: string, tree: string | null): Promise<string> {
		if (!text.includes("#")) {
			return "";
		}
		// A config that will not load, or a registry that will not read, names
		// none, rather than holding the message back.
		const named =
			tree === null
				? null
				: await Systems.at(tree, { fs: this.fs }).catch(() => null);
		const listed = (await this.projects?.list().catch(() => null)) ?? [];
		const projects = listed.filter((each) => !each.gone);
		const systems = named?.mentioned(text) ?? [];
		const unknown = named?.unknown(text) ?? [];
		const found = hashed(text).flatMap((called) => {
			const project = projects.find((each) => each.slug === called);
			return project === undefined || (named?.find(called) ?? null) !== null
				? []
				: [project];
		});
		return [
			...systems.map(mentionLine),
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
			...unknown
				.filter((called) => !found.some((each) => each.slug === called))
				.map(unknownLine),
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
