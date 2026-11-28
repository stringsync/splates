// Draws the app icon: the stacked-plate buddy on splates' near-black background,
// full bleed so iOS can round the corners itself. Run on a Mac from this directory,
// once per size: `swift render.swift 512 icon-512.png`, and the same for 192.
import AppKit

let size = CGFloat(Int(CommandLine.arguments[1])!)
let out = CommandLine.arguments[2]
let scale = size / 32.0

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> NSColor {
	NSColor(srgbRed: r / 255.0, green: g / 255.0, blue: b / 255.0, alpha: a)
}

let image = NSBitmapImageRep(
	bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
	bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
	colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)

// Calm near-black vertical gradient matching the mock app icon.
let bgGradient = NSGradient(starting: color(0x1b, 0x1b, 0x20), ending: color(0x11, 0x11, 0x14))!
bgGradient.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: 270)

// Transform a 32x32 top-down coordinate space into the middle 66% of the icon.
let glyphSize = size * 0.66
let offset = (size - glyphSize) / 2.0
let s = glyphSize / 32.0

func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ radius: CGFloat) -> NSBezierPath {
	let flippedY = size - offset - (y + h) * s
	return NSBezierPath(
		roundedRect: NSRect(x: offset + x * s, y: flippedY, width: w * s, height: h * s),
		xRadius: radius * s, yRadius: radius * s)
}

// Lower plate
let lower = rect(4, 11, 24, 17, 6)
color(0x18, 0x18, 0x1d).setFill()
lower.fill()
lower.lineWidth = 1.2 * s
color(255, 255, 255, 0.14).setStroke()
lower.stroke()

// Upper plate
let upper = rect(3, 6, 26, 19, 6.5)
color(0x2c, 0x2c, 0x34).setFill()
upper.fill()
upper.lineWidth = 1.2 * s
color(255, 255, 255, 0.22).setStroke()
upper.stroke()

// Eyes
color(0xf4, 0xf4, 0xf5).setFill()
rect(11.8, 12.2, 2.8, 5.6, 1.4).fill()
rect(17.4, 12.2, 2.8, 5.6, 1.4).fill()

NSGraphicsContext.restoreGraphicsState()
try! image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
