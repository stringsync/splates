import { createContext } from "react";

/** A composer an image found elsewhere on the page can be added to. */
export interface Composer {
	addAttachment(file: File): Promise<void>;
}

/**
 * The composer of the conversation the page shows, for an image in its thread
 * to be marked up and sent back; null where no conversation is open.
 */
export const Composing = createContext<Composer | null>(null);
