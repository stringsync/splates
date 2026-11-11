const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const DURATION = 0x4489;
const TIMECODE_SCALE = 0x2ad7b1;

/**
 * Returns `webm` with a Duration of `durationMs` in its Info element, or the
 * same bytes when it has one already or is not a WebM this can read. A
 * `MediaRecorder` streams without knowing its length, so its header has none
 * and players guess it from the bytes fetched so far.
 */
export function withWebmDuration(
	webm: Uint8Array,
	durationMs: number,
): Uint8Array {
	if (!(durationMs > 0)) {
		return webm;
	}
	const ebml = readId(webm, 0);
	if (ebml?.id !== EBML) {
		return webm;
	}
	const ebmlSize = readSize(webm, ebml.len);
	if (!ebmlSize || ebmlSize.size < 0) {
		return webm;
	}
	const segmentAt = ebml.len + ebmlSize.len + ebmlSize.size;
	const segment = readId(webm, segmentAt);
	if (segment?.id !== SEGMENT) {
		return webm;
	}
	const segmentSize = readSize(webm, segmentAt + segment.len);
	if (!segmentSize) {
		return webm;
	}
	let at = segmentAt + segment.len + segmentSize.len;
	while (at < webm.length) {
		const id = readId(webm, at);
		if (!id) {
			return webm;
		}
		const size = readSize(webm, at + id.len);
		if (!size || size.size < 0) {
			return webm;
		}
		const bodyAt = at + id.len + size.len;
		if (id.id !== INFO) {
			at = bodyAt + size.size;
			continue;
		}
		const bodyEnd = bodyAt + size.size;
		if (bodyEnd > webm.length) {
			return webm;
		}
		let scale = 1_000_000;
		for (let child = bodyAt; child < bodyEnd; ) {
			const cid = readId(webm, child);
			const csize = cid && readSize(webm, child + cid.len);
			if (!cid || !csize || csize.size < 0) {
				return webm;
			}
			if (cid.id === DURATION) {
				return webm;
			}
			const cbody = child + cid.len + csize.len;
			if (cid.id === TIMECODE_SCALE) {
				let value = 0;
				for (let i = 0; i < csize.size; i++) {
					value = value * 256 + (webm[cbody + i] ?? 0);
				}
				if (value > 0) {
					scale = value;
				}
			}
			child = cbody + csize.size;
		}
		const duration = new Uint8Array(11);
		duration.set([0x44, 0x89, 0x88]);
		new DataView(duration.buffer).setFloat64(3, (durationMs * 1e6) / scale);
		// The size is rewritten at 8 bytes, so any length fits.
		const newSize = size.size + duration.length;
		const header = new Uint8Array(id.len + 8);
		header.set(webm.subarray(at, at + id.len));
		header[id.len] = 0x01;
		let rest = newSize;
		for (let i = 7; i >= 1; i--) {
			header[id.len + i] = rest % 256;
			rest = Math.floor(rest / 256);
		}
		const out = new Uint8Array(
			webm.length - (bodyAt - at) + header.length + duration.length,
		);
		out.set(webm.subarray(0, at));
		out.set(header, at);
		out.set(webm.subarray(bodyAt, bodyEnd), at + header.length);
		out.set(duration, at + header.length + size.size);
		out.set(webm.subarray(bodyEnd), at + header.length + newSize);
		return out;
	}
	return webm;
}

/** Reads an element id (its marker bits kept) at `at`. */
function readId(
	bytes: Uint8Array,
	at: number,
): { id: number; len: number } | null {
	const first = bytes[at];
	if (first === undefined || first === 0) {
		return null;
	}
	const len = Math.clz32(first) - 23;
	if (len > 4 || at + len > bytes.length) {
		return null;
	}
	let id = 0;
	for (let i = 0; i < len; i++) {
		id = id * 256 + (bytes[at + i] ?? 0);
	}
	return { id, len };
}

/** Reads an element size at `at`; `size` is -1 when unknown. */
function readSize(
	bytes: Uint8Array,
	at: number,
): { size: number; len: number } | null {
	const first = bytes[at];
	if (first === undefined || first === 0) {
		return null;
	}
	const len = Math.clz32(first) - 23;
	if (at + len > bytes.length) {
		return null;
	}
	let size = first & (0xff >> len);
	let unknown = size === 0xff >> len;
	for (let i = 1; i < len; i++) {
		const byte = bytes[at + i] ?? 0;
		if (byte !== 0xff) {
			unknown = false;
		}
		size = size * 256 + byte;
	}
	return { size: unknown ? -1 : size, len };
}
