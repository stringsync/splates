import { dlopen, FFIType, ptr } from "bun:ffi";

/** `HOST_VM_INFO64`, and the size of `vm_statistics64` in 32-bit words. */
const HOST_VM_INFO64 = 4;
const WORDS = 40;

/** Where each count sits in `vm_statistics64`, in 32-bit words. */
const WIRED = 3;
const PURGEABLE = 22;
const COMPRESSOR = 32;
const ANONYMOUS = 35;

/**
 * The pages apps and the system hold, from a `vm_statistics64`: the sum
 * Activity Monitor calls Memory Used.
 */
export function heldPages(stats: Uint32Array): number {
	// App memory, then wired and compressed. File cache stays out: macOS
	// reclaims it on demand and fills free memory with it, which leaves
	// `os.freemem()` near nothing on a machine with plenty to spare.
	const anonymous = (stats[ANONYMOUS] ?? 0) - (stats[PURGEABLE] ?? 0);
	return (
		Math.max(anonymous, 0) + (stats[WIRED] ?? 0) + (stats[COMPRESSOR] ?? 0)
	);
}

/**
 * The bytes of the machine's `total` not held by apps and the system, or null
 * when the kernel will not say.
 */
export function darwinAvailable(total: number): number | null {
	opened ??= open();
	const stats = new Uint32Array(WORDS);
	const count = new Uint32Array([WORDS]);
	const failed = opened.host_statistics64(
		opened.mach_host_self(),
		HOST_VM_INFO64,
		ptr(stats),
		ptr(count),
	);
	if (failed !== 0) {
		return null;
	}
	return Math.max(total - heldPages(stats) * opened.getpagesize(), 0);
}

let opened: ReturnType<typeof open> | null = null;

/** Opened on the first reading, never on import, so Linux never tries. */
function open() {
	return dlopen("/usr/lib/libSystem.B.dylib", {
		mach_host_self: { args: [], returns: FFIType.u32 },
		getpagesize: { args: [], returns: FFIType.i32 },
		host_statistics64: {
			args: [FFIType.u32, FFIType.i32, FFIType.ptr, FFIType.ptr],
			returns: FFIType.i32,
		},
	}).symbols;
}
