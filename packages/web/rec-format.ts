/** Seconds as `m:ss`, or `h:mm:ss` past an hour. */
export function clock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const secs = String(whole % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
		: `${minutes}:${secs}`;
}

/** Bytes as `1.8 GB`, `312 MB` or `4 KB`. */
export function bytesText(bytes: number): string {
	if (bytes >= 1e9) {
		return `${(bytes / 1e9).toFixed(1)} GB`;
	}
	if (bytes >= 1e6) {
		return `${Math.round(bytes / 1e6)} MB`;
	}
	return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
