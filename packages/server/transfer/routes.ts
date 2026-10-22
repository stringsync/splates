import { basename } from "node:path";
import type { Fs, Ps } from "webappwiz/system";
import type { Creds } from "../creds";
import { Exit, fail } from "../exit";
import { splatesHome } from "../models";
import { body } from "../server/shared";
import type { Storage } from "../storage";
import { askAgain, exportBundle, importBundle, parseBundle } from "./transfer";

/** What the routes read and write a project's export through. */
export interface TransferProject {
	fs: Fs;
	ps: Ps;
	/** The project's records, which an export reads and an import writes. */
	storage: Storage;
	/** The project's directory under the splates home, where an upload waits. */
	dir: string;
	/** Its main tree, which names the file an export downloads as. */
	root: string;
	/** What its agents asked for, which an export names and an import asks for again. */
	creds: Creds;
}

/** An upload's id, as the page makes one. */
const UPLOAD = /^[a-z0-9-]{8,64}$/;

/**
 * Setup's export and import of a project's records and the machine's
 * settings, as `splates config` does them, but under a running server: an
 * upload comes in parts, since an export outgrows one request, and an import
 * leaves the conversations here as they are, since each running one writes
 * its own log, then has the server read what it wrote.
 */
export class TransferRoutes {
	readonly #project: TransferProject;
	/** Reads what an import wrote that the server keeps in memory. */
	readonly #imported: () => Promise<void>;

	constructor(project: TransferProject, imported: () => Promise<void>) {
		this.#project = project;
		this.#imported = imported;
	}

	/** The export as a file to download, without conversations for `?conversations=0`. */
	readonly exportConfig = async (request: Request): Promise<Response> => {
		const { fs, ps, storage, root, creds } = this.#project;
		const conversations =
			new URL(request.url).searchParams.get("conversations") !== "0";
		const bundle = await exportBundle(
			{ fs, storage, home: splatesHome(ps) },
			await creds.requests(),
			{ conversations },
		);
		const day = new Date().toISOString().slice(0, 10);
		return new Response(`${JSON.stringify(bundle, null, "\t")}\n`, {
			headers: {
				"content-type": "application/json",
				"content-disposition": `attachment; filename="splates-${basename(root)}-${day}.json"`,
			},
		});
	};

	/**
	 * Adds part `?part=` of upload `?upload=` to what came before it, the
	 * first part starting it over; the body is the part's text.
	 */
	readonly uploadPart = async (request: Request): Promise<Response> => {
		const params = new URL(request.url).searchParams;
		const path = this.#upload(params.get("upload") ?? "");
		const part = Number(params.get("part"));
		if (!Number.isInteger(part) || part < 0) {
			fail("usage", "send ?part= as a count from 0", { part });
		}
		const text = await request.text();
		if (part === 0) {
			// One import at a time: a new one clears any left behind, as a
			// cancelled one is.
			await this.#project.fs.rm(this.#uploads, {
				recursive: true,
				force: true,
			});
			await this.#project.fs.mkdir(this.#uploads, { recursive: true });
			await this.#project.fs.write(path, text);
		} else {
			if (!(await this.#project.fs.exists(path))) {
				fail("not_found", "that upload has no part 0: start it again", {});
			}
			await this.#project.fs.append(path, text);
		}
		return new Response(null, { status: 204 });
	};

	/**
	 * Imports upload `{ upload }`, `{ force }` to overwrite what differs here,
	 * answering what it wrote, kept and asked for again of the creds; a 409 naming the files that differ
	 * otherwise, the upload kept for a forced try.
	 */
	readonly importConfig = async (request: Request): Promise<Response> => {
		const { upload = "", force = false } = await body(request);
		if (typeof upload !== "string" || typeof force !== "boolean") {
			fail("usage", "send { upload: string, force?: boolean }", {});
		}
		const { fs, ps, storage } = this.#project;
		const path = this.#upload(upload);
		if (!(await fs.exists(path))) {
			fail("not_found", "that upload is gone: choose the file again", {});
		}
		const bundle = parseBundle(await fs.read(path), "the file");
		try {
			const done = await importBundle(
				{ fs, storage, home: splatesHome(ps) },
				bundle,
				{ force, keep: ["conversations"] },
			);
			await fs.rm(path, { force: true });
			const asked = await askAgain(this.#project.creds, bundle);
			await this.#imported();
			return Response.json({ written: done.written, kept: done.kept, asked });
		} catch (error) {
			if (error instanceof Exit && error.reason === "exists") {
				return Response.json(
					{
						reason: error.reason,
						message: error.message,
						conflicts: error.data.conflicts,
					},
					{ status: 409 },
				);
			}
			throw error;
		}
	};

	get #uploads(): string {
		return `${this.#project.dir}/imports`;
	}

	#upload(id: string): string {
		if (!UPLOAD.test(id)) {
			fail("usage", "send ?upload= as the id the page made", { upload: id });
		}
		return `${this.#uploads}/${id}.json`;
	}
}
