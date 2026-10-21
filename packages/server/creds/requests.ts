import { z } from "zod";
import { PROVIDERS, type Provider, SCOPES, type Scope } from "./stores";

export const REQUEST = z.object({
	name: z.string(),
	scope: z.enum(SCOPES),
	/** Who keeps it once saved; the system's in a record from before providers. */
	provider: z.enum(PROVIDERS).default("system"),
	/** Why it is needed and what for; empty in a record from before requests said. */
	purpose: z.string().default(""),
	/** How to get it, as markdown, from the agent that asked. */
	instructions: z.string(),
	/** The task that asked, or null for an agent in none. */
	task: z.string().nullable(),
	/** Open until a person saves a value for it or dismisses it. */
	status: z.enum(["open", "saved", "dismissed"]),
	requestedAt: z.string(),
});

/** A cred an agent asked a person for, with what for and how to get it. */
export type CredRequest = z.infer<typeof REQUEST>;

export const FILE = z.object({
	/** One per name, the latest, so a card in a thread follows what became of it. */
	requests: z.array(REQUEST).default([]),
	/** What saved each cred a tool saved itself, by `<scope>:<name>`. */
	savedBy: z.record(z.string(), z.string()).default({}),
});

export type CredsFile = z.infer<typeof FILE>;

/** A cred a store keeps, by name; never its value. */
export interface KeptCred {
	name: string;
	scope: Scope;
	provider: Provider;
	/** The tool that saved it, when one said so; null when a person did. */
	savedBy: string | null;
}
