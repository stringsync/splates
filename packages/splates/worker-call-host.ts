import type { Resource } from "webappwiz/disposable";
import { z } from "zod";
import type { WorkerChannel } from "./worker-channel";
import type { WorkerMachine } from "./worker-machine";
import type { Json } from "./worker-protocol";

/** A question a coordinator asks on a `calls` channel, answered by its id. */
export const CallRequest = z.discriminatedUnion("method", [
	z.object({
		id: z.number().int(),
		method: z.literal("git"),
		cwd: z.string(),
		args: z.array(z.string()),
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
	}),
]);
export type CallRequest = z.infer<typeof CallRequest>;

/** How a worker answers: `{ id, result }`, or `{ id, error }` saying what went wrong. */
export const CallAnswer = z.union([
	z.object({ id: z.number().int(), result: z.unknown() }),
	z.object({ id: z.number().int(), error: z.string() }),
]);

/**
 * Answers a coordinator's calls on the machine a task runs on, each request
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
			case "git":
				return { ...(await this.machine.git(request.cwd, request.args)) };
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
				return { size, bytes: Buffer.from(bytes).toString("base64") };
			}
		}
	}

	private reply(
		answer: { id: number; result: Json } | { id: number; error: string },
	): void {
		if (!this.channel.closed) {
			this.channel.send(answer);
		}
	}
}
