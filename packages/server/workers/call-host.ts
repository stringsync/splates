import type { SecretStore } from "webappwiz/creds";
import type { Resource } from "webappwiz/disposable";
import { z } from "zod";
import type { WorkerChannel } from "./channel";
import { ProjectCheckout } from "./checkouts";
import { FrameTooLarge } from "./frame-too-large";
import type { WorkerMachine } from "./machine";
import { type WakeSender, WakeTarget } from "./magic-packet";
import type { Json } from "./protocol";
import { SentKey } from "./task-keys";

/** The capability of a worker that answers `servers` (protocol 1.2). */
export const SERVERS = "servers";

/** The most of a git call's output in one part: characters, up to three bytes each. */
const GIT_PART = 512 * 1024;

/** The most of a file one read answers with, once the server gives a limit. */
export const READ_PART = 2 * 1024 * 1024;

/**
 * Answers a server's calls on the machine a task runs on, each request
 * a message on a `calls` channel and each answer one back, in whatever order
 * they finish. A read's bytes go as base64.
 */
export class WorkerCallHost implements Resource {
	private readonly unlisten: () => void;

	constructor(
		private readonly channel: WorkerChannel,
		private readonly machine: WorkerMachine,
		/** What sends a magic packet for `wake`; none, refusing it, by default. */
		private readonly waker: WakeSender | null = null,
		/** Where the keys `keys` sends are kept; none, refusing them, by default. */
		private readonly store: SecretStore | null = null,
	) {
		this.unlisten = channel.events.on(
			"message",
			({ body }) => void this.answer(body),
		);
	}

	/** Stops answering, leaving the channel to whoever closes it. */
	dispose(): void {
		this.unlisten();
	}

	private async answer(body: Json): Promise<void> {
		const parsed = CallRequest.safeParse(body);
		if (!parsed.success) {
			const id = (body as { id?: unknown } | null)?.id;
			this.reply({
				id: typeof id === "number" ? id : -1,
				error: `not a call: ${parsed.error.message}`,
			});
			return;
		}
		const request = parsed.data;
		try {
			this.reply({ id: request.id, result: await this.call(request) });
		} catch (error) {
			this.reply({
				id: request.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async call(request: CallRequest): Promise<Json> {
		switch (request.method) {
			case "git": {
				const result = await this.machine.git(
					request.cwd,
					request.args,
					request.env,
				);
				if (request.chunked !== true) {
					return { ...result };
				}
				// Past one frame's worth, the output goes ahead of the answer in parts.
				for (const stream of ["stdout", "stderr"] as const) {
					const text = result[stream];
					if (text.length <= GIT_PART) {
						continue;
					}
					for (let at = 0; at < text.length; at += GIT_PART) {
						this.channel.send({
							id: request.id,
							part: stream,
							text: text.slice(at, at + GIT_PART),
						});
					}
					result[stream] = "";
				}
				return { ...result };
			}
			case "processes":
				return (await this.machine.processes()).map((each) => ({ ...each }));
			case "listening":
				return (await this.machine.listening()).map((each) => ({ ...each }));
			case "exists":
				return await this.machine.exists(request.path);
			case "read": {
				const { size, bytes } = await this.machine.read(
					request.path,
					request.from,
				);
				// A server that sends a limit asks again for the rest.
				const taken =
					request.limit === undefined
						? bytes
						: bytes.subarray(0, request.limit);
				return { size, bytes: Buffer.from(taken).toString("base64") };
			}
			case "checkout":
				return await this.machine.checkout(request.request);
			case "removeCheckout":
				await this.machine.removeCheckout(request.path);
				return null;
			case "servers":
				return (await this.machine.servers()) as unknown as Json;
			case "wake": {
				if (this.waker === null) {
					throw new Error("this worker sends no Wake-on-LAN packet");
				}
				const target = WakeTarget.parse(request);
				await this.waker.send(target);
				return null;
			}
			case "keys": {
				if (this.store === null) {
					throw new Error("this worker keeps no keys");
				}
				// The whole set each time, so a key the server took away goes.
				const sent = new Set(request.keys.map((key) => key.cred));
				for (const name of await this.store.names()) {
					if (!sent.has(name)) {
						await this.store.delete(name);
					}
				}
				for (const { cred, value } of request.keys) {
					await this.store.set(cred, value);
				}
				return null;
			}
		}
	}

	private reply(
		answer: { id: number; result: Json } | { id: number; error: string },
	): void {
		if (this.channel.closed) {
			return;
		}
		try {
			this.channel.send(answer);
		} catch (error) {
			if (!(error instanceof FrameTooLarge) || "error" in answer) {
				throw error;
			}
			// An answer the link would not carry is told as an error instead.
			this.channel.send({ id: answer.id, error: error.message });
		}
	}
}

/** A question a server asks on a `calls` channel, answered by its id. */
export const CallRequest = z.discriminatedUnion("method", [
	z.object({
		id: z.number().int(),
		method: z.literal("git"),
		cwd: z.string(),
		args: z.array(z.string()),
		env: z.record(z.string(), z.string()).optional(),
		/** Asks for output past one frame's worth in `part` answers ahead of the result; a worker before this sends it whole. */
		chunked: z.boolean().optional(),
	}),
	z.object({ id: z.number().int(), method: z.literal("processes") }),
	z.object({ id: z.number().int(), method: z.literal("listening") }),
	z.object({
		id: z.number().int(),
		method: z.literal("exists"),
		path: z.string(),
	}),
	z.object({
		id: z.number().int(),
		method: z.literal("read"),
		path: z.string(),
		from: z.number().int().nonnegative(),
		/** At most this many bytes; a worker before this sends all of them. */
		limit: z.number().int().positive().optional(),
	}),
	z.object({
		id: z.number().int(),
		method: z.literal("checkout"),
		request: ProjectCheckout,
	}),
	z.object({
		id: z.number().int(),
		method: z.literal("removeCheckout"),
		path: z.string(),
	}),
	z.object({ id: z.number().int(), method: z.literal("servers") }),
	z.object({
		id: z.number().int(),
		method: z.literal("wake"),
		mac: z.string(),
		broadcast: z.string(),
	}),
	/** Every key the worker holds now, replacing those it kept (protocol 1.5). */
	z.object({
		id: z.number().int(),
		method: z.literal("keys"),
		keys: z.array(SentKey),
	}),
]);
export type CallRequest = z.infer<typeof CallRequest>;

/** How a worker answers: `{ id, result }`, or `{ id, error }` saying what went wrong. */
export const CallAnswer = z.union([
	/** A piece of a git call's `stdout` or `stderr`, ahead of its result. */
	z.object({
		id: z.number().int(),
		part: z.enum(["stdout", "stderr"]),
		text: z.string(),
	}),
	z.object({ id: z.number().int(), result: z.unknown() }),
	z.object({ id: z.number().int(), error: z.string() }),
]);
