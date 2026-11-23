import { z } from "zod";

/**
 * The rig protocol, as `docs/rigs.md` lays it out: what a command `rigs`
 * names answers `describe` with, and how splates starts one of its rigs.
 * Browser-safe: the page reads the same types.
 */

const NAME = z
	.string()
	.regex(/^[a-z][a-z0-9-]*$/, "a lowercase name, as dev or mock-api");

const BASE = {
	name: NAME,
	label: z.string().min(1).optional(),
	description: z.string().optional(),
};

/** One typed option a rig starts with, each with its default. */
export const OPTION = z.discriminatedUnion("type", [
	z.object({ ...BASE, type: z.literal("boolean"), default: z.boolean() }),
	z.object({ ...BASE, type: z.literal("string"), default: z.string() }),
	z.object({ ...BASE, type: z.literal("number"), default: z.number() }),
	z
		.object({
			...BASE,
			type: z.literal("enum"),
			values: z.array(z.string().min(1)).min(1),
			default: z.string(),
		})
		.refine((option) => option.values.includes(option.default), {
			message: "an enum's default is one of its values",
		}),
]);
export type RigOption = z.infer<typeof OPTION>;

/**
 * When a running rig counts as up: `http` answering 2xx or 3xx to a GET on
 * its main port (or the one `port` names), or `command` exiting 0 in its tree.
 */
export const HEALTH = z.union([
	z.object({ http: z.string().startsWith("/"), port: NAME.optional() }),
	z.object({ command: z.string().min(1) }),
]);
export type RigHealth = z.infer<typeof HEALTH>;

/**
 * How splates exposes a rig: `tunnel` through splates's ports host on a
 * persistent animal slot, `none` for local only, or `self` when the rig
 * prints its own public URL on stdout (`splates:url ...`).
 */
export const EXPOSURE = z.enum(["tunnel", "none", "self"]);
export type RigExposure = z.infer<typeof EXPOSURE>;

/** A dev server a rig command declares. */
export const RIG = z
	.object({
		name: NAME,
		label: z.string().min(1),
		description: z.string().optional(),
		/**
		 * The ports it listens on, by name, the first its main one: splates
		 * picks each a free port and passes it as `PORT_<NAME>`, the first as
		 * `PORT` too. One unnamed `web` when left out.
		 */
		ports: z.array(NAME).min(1).default(["web"]),
		/** How splates exposes its ports; `tunnel` when left out. */
		exposure: EXPOSURE.default("tunnel"),
		health: HEALTH.optional(),
		options: z.array(OPTION).default([]),
	})
	.superRefine((rig, context) => {
		const repeated = (names: string[]) =>
			names.find((name, index) => names.indexOf(name) !== index);
		const port = repeated(rig.ports);
		if (port !== undefined) {
			context.addIssue({ code: "custom", message: `port "${port}" twice` });
		}
		const option = repeated(rig.options.map((each) => each.name));
		if (option !== undefined) {
			context.addIssue({
				code: "custom",
				message: `option "${option}" twice`,
			});
		}
		if (
			rig.health !== undefined &&
			"http" in rig.health &&
			rig.health.port !== undefined &&
			!rig.ports.includes(rig.health.port)
		) {
			context.addIssue({
				code: "custom",
				message: `health checks port "${rig.health.port}", which it does not declare`,
			});
		}
	});
export type Rig = z.infer<typeof RIG>;

/** What a rig command answers `describe` with: its group's name and its rigs. */
export const DESCRIBED = z
	.object({
		name: NAME,
		label: z.string().min(1).optional(),
		rigs: z.array(RIG),
	})
	.superRefine((described, context) => {
		const names = described.rigs.map((rig) => rig.name);
		const twice = names.find((name, index) => names.indexOf(name) !== index);
		if (twice !== undefined) {
			context.addIssue({ code: "custom", message: `rig "${twice}" twice` });
		}
	});
export type Described = z.infer<typeof DESCRIBED>;
