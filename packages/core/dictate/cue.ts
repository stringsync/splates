/** A sound that says the mic went live, or stopped. */
export type Cue = "start" | "stop";

/** How long each note of a cue rings. */
const NOTE = 0.07;

/** The pitches of each cue: rising as the mic opens, falling as it closes. */
const NOTES: Record<Cue, readonly number[]> = {
	start: [660, 880],
	stop: [880, 660],
};

/** How long a cue lasts, in milliseconds. */
export function cueLength(cue: Cue): number {
	return NOTES[cue].length * NOTE * 1000;
}

/**
 * Plays `cue` on `context` as soft sine notes, so no file ships. Resolves
 * when it has finished, or at once when the context cannot play, as one the
 * system interrupted cannot.
 */
export function playCue(context: AudioContext, cue: Cue): Promise<void> {
	if (context.state !== "running") {
		return Promise.resolve();
	}
	const gain = context.createGain();
	gain.connect(context.destination);
	const begin = context.currentTime;
	const notes = NOTES[cue];
	const end = begin + notes.length * NOTE;
	// A short fade in and out keeps each note from clicking.
	gain.gain.setValueAtTime(0, begin);
	gain.gain.linearRampToValueAtTime(0.08, begin + 0.01);
	gain.gain.setValueAtTime(0.08, end - 0.02);
	gain.gain.linearRampToValueAtTime(0, end);
	const oscillator = context.createOscillator();
	oscillator.type = "sine";
	notes.forEach((pitch, index) => {
		oscillator.frequency.setValueAtTime(pitch, begin + index * NOTE);
	});
	oscillator.connect(gain);
	return new Promise((resolve) => {
		oscillator.onended = () => {
			gain.disconnect();
			resolve();
		};
		oscillator.start(begin);
		oscillator.stop(end);
	});
}
