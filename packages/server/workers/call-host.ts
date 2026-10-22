import type { Resource } from "webappwiz/disposable";
import { z } from "zod";
import type { WorkerChannel } from "./channel";
import { FrameTooLarge } from "./frame-too-large";
import type { WorkerMachine } from "./machine";
import type { Json } from "./protocol";

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
