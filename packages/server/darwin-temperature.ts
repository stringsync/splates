import { CString, dlopen, FFIType, type Pointer, ptr } from "bun:ffi";

const IOKIT = "/System/Library/Frameworks/IOKit.framework/IOKit";
const CORE_FOUNDATION =
	"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";

/** `kCFStringEncodingUTF8`. */
const UTF8 = 0x08000100;

/** `kIOHIDEventTypeTemperature`, and the field holding its degrees. */
const TEMPERATURE = 15;
const DEGREES = TEMPERATURE << 16;

/** What Apple Silicon calls its CPU die sensors: `PMU tdie1` and on. */
const DIE = /^PMU tdie\d+$/;

/**
 * The hottest CPU die sensor on an Apple Silicon Mac, in °C, or null when
 * none answers. macOS has no public API for these, and `powermetrics` needs
 * sudo, so this asks IOKit's private HID event system the way macmon and
 * Stats do, which any user may.
 */
export function darwinTemperature(): number | null {
	const { io, cf } = libraries();
	sensors ??= dieSensors();
	let hottest: number | null = null;
	for (const service of sensors) {
		const event = io.IOHIDServiceClientCopyEvent(service, TEMPERATURE, 0, 0);
		if (event === null) {
			continue;
		}
		const degrees = io.IOHIDEventGetFloatValue(event, DEGREES);
		cf.CFRelease(event);
		if (Number.isFinite(degrees) && degrees > 0) {
			hottest = Math.max(hottest ?? 0, degrees);
		}
	}
	return hottest;
}

/**
 * The die sensors, found once and kept with their client for the life of the
 * process: a client made and released on each reading leaks.
 */
let sensors: Pointer[] | null = null;

function dieSensors(): Pointer[] {
	const { io, cf } = libraries();
	const client = io.IOHIDEventSystemClientCreate(null);
	const services =
		client === null ? null : io.IOHIDEventSystemClientCopyServices(client);
	if (services === null) {
		return [];
	}
	const product = cf.CFStringCreateWithCString(null, cstring("Product"), UTF8);
	const name = new Uint8Array(256);
	const found: Pointer[] = [];
	const count = Number(cf.CFArrayGetCount(services));
	for (let i = 0; i < count; i++) {
		const service = cf.CFArrayGetValueAtIndex(services, i);
		const called =
			service === null
				? null
				: io.IOHIDServiceClientCopyProperty(service, product);
		if (service === null || called === null) {
			continue;
		}
		const read = cf.CFStringGetCString(called, ptr(name), name.length, UTF8);
		cf.CFRelease(called);
		if (read && DIE.test(new CString(ptr(name)).toString())) {
			found.push(service);
		}
	}
	if (product !== null) {
		cf.CFRelease(product);
	}
	return found;
}

function cstring(text: string): Buffer {
	return Buffer.from(`${text}\0`);
}

type Libraries = ReturnType<typeof open>;

let opened: Libraries | null = null;

/** Opened on the first reading, never on import, so Linux never tries. */
function libraries(): Libraries {
	opened ??= open();
	return opened;
}

function open() {
	const io = dlopen(IOKIT, {
		IOHIDEventSystemClientCreate: {
			args: [FFIType.ptr],
			returns: FFIType.ptr,
		},
		IOHIDEventSystemClientCopyServices: {
			args: [FFIType.ptr],
			returns: FFIType.ptr,
		},
		IOHIDServiceClientCopyProperty: {
			args: [FFIType.ptr, FFIType.ptr],
			returns: FFIType.ptr,
		},
		IOHIDServiceClientCopyEvent: {
			args: [FFIType.ptr, FFIType.i64, FFIType.i32, FFIType.i64],
			returns: FFIType.ptr,
		},
		IOHIDEventGetFloatValue: {
			args: [FFIType.ptr, FFIType.i32],
			returns: FFIType.f64,
		},
	}).symbols;
	const cf = dlopen(CORE_FOUNDATION, {
		CFStringCreateWithCString: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
			returns: FFIType.ptr,
		},
		CFStringGetCString: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.i64, FFIType.u32],
			returns: FFIType.bool,
		},
		CFArrayGetCount: { args: [FFIType.ptr], returns: FFIType.i64 },
		CFArrayGetValueAtIndex: {
			args: [FFIType.ptr, FFIType.i64],
			returns: FFIType.ptr,
		},
		CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
	}).symbols;
	return { io, cf };
}
