import type { Resource } from "core/disposable";
import type { Eventful } from "core/events";
import type { AudioSink } from "./microphone";

export interface DictationLinkEvents extends Record<string, unknown> {
	/** All the take's text so far, rough until it is done. */
	heard: string;
	/** Why the take broke off mid-way. */
	failed: undefined;
	/** The link closed before the take was done. */
	closed: undefined;
}

/** One take on its way to the server: audio up, text back. */
export interface DictationLink
	extends AudioSink,
		Eventful<DictationLinkEvents>,
		Resource {
	/** Ends the take, resolving with its final text; rejects with a `DictationFailure`. */
	finish(): Promise<string>;
}

/** Opens a take's link to the server. */
export type OpenLink = () => Promise<DictationLink>;
