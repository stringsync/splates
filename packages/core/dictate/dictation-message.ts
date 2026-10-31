/**
 * What the server says on a dictation's socket, as JSON text. The page sends
 * the take's audio as bytes, PCM16 at `SAMPLE_RATE`, then "finish" as text.
 */
export type DictationMessage =
	/** All the take's text so far, rough until it is done. */
	| { type: "heard"; text: string }
	/**
	 * Why the take broke off; `cred` names the cred it needs, which the Creds
	 * page now asks for.
	 */
	| { type: "failed"; message: string; cred?: string }
	/** The take's final text, after "finish". */
	| { type: "done"; text: string };
