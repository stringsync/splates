import { z } from "zod";

const id = z.string().min(1);
const integer = z.number().int().nonnegative();
const match = z.object({
	actor: z.enum(["agent", "cli", "fixture"]),
	kind: z.enum(["command", "read", "write", "directive"]),
	name: id,
	args: z.array(z.string()).optional(),
	exitCode: z.number().int().optional(),
	payload: z.json().optional(),
});
const channel = z.enum(["events", "state", "reply"]);
/** Validate a probe loaded from an aspect module or stored result before using it. */
export const probeSchema = z.object({
	schema: z.literal(1),
	id,
	version: id,
	requirement: z.object({ id, text: id, source: id }),
	aspect: id,
	seed: z.object({ id, version: id, data: z.json() }),
	input: z.object({
		kind: z.enum(["message", "directive"]),
		text: z.string(),
		origin: z.enum(["user", "cli"]),
	}),
	tools: z.array(id),
	evidence: z.array(channel),
	assertions: z.array(
		z.discriminatedUnion("kind", [
			z.object({
				id,
				kind: z.literal("count"),
				match,
				min: integer,
				max: integer.optional(),
			}),
			z.object({ id, kind: z.literal("before"), first: match, second: match }),
			z.object({ id, kind: z.literal("state"), key: id, equals: z.json() }),
			z.object({
				id,
				kind: z.literal("reply"),
				type: z.enum([
					"text",
					"questions",
					"review",
					"proposal",
					"report",
					"start",
					"todo",
					"demo",
					"assumed",
				]),
				field: z.array(z.string()),
				equals: z.json(),
			}),
			z.object({ id, kind: z.literal("uncovered"), reason: id }),
		]),
	),
	stop: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("reply") }),
		z.object({ kind: z.literal("event"), match }),
	]),
	bounds: z
		.object({
			milliseconds: integer.positive(),
			turns: integer.positive(),
			tokens: integer.positive(),
		})
		.strict(),
	execution: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("cli"), command: z.array(z.string()).min(1) }),
		z.object({ kind: z.literal("agent"), skill: id }),
	]),
});

export const eventSchema = match.extend({ id, args: z.array(z.string()) });
export const evidenceSchema = z.object({
	events: z.array(eventSchema),
	state: z.record(z.string(), z.json()),
	reply: z.string().optional(),
	complete: z.array(channel),
	termination: z.enum(["stop", "bound", "infrastructure-error", "unsupported"]),
	detail: z.string().optional(),
});
