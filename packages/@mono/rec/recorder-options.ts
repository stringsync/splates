import type { Routes } from "./run";
import type { Scrubber } from "./scrub";

/** What the control window is opened with. */
export interface OpenOptions {
	grantMic: boolean;
	/** Where the working tab goes once the side panel is open. */
	workingUrl: string;
	scrubber?: Scrubber;
	docker?: string;
	tails?: string[];
	/** Open the control window idle: nothing is captured or written until its Start button is pressed. */
	staged?: boolean;
	/** The session is narrated by remarks, not a mic: the control window opens none. */
	noMic?: boolean;
	/** OpenAI key for the live transcript shown while recording; without it nothing is shown live. */
	liveKey?: string;
	/** The most frames per second the screencast sends; the default is `DEFAULT_MAX_FPS`. */
	fps?: number;
	/** Send no frames at all, so the window browses with nothing recording it: the bench's baseline. */
	noScreencast?: boolean;
}

export interface RecorderServerOptions {
	routes?: Routes;
	baseName?: string;
	usedNames?: ReadonlySet<string>;
	/** The file holding the mic the person chose; without it the choice is not remembered. */
	micFile?: string;
}
