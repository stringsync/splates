// Draws the app icon: the 🌲 emoji as macOS draws it, on the page's dark
// background, full bleed so iOS can round the corners itself. Run on a Mac
// from this directory, once per size: `swift render.swift 512 icon-512.png`,
// and the same for 192.
import AppKit

let size = CGFloat(Int(CommandLine.arguments[1])!)
let out = CommandLine.arguments[2]
// `--background` in dark mode, as styles.css has it.
let background = NSColor(srgbRed: 0x1d / 255.0, green: 0x1f / 255.0, blue: 0x23 / 255.0, alpha: 1)

let image = NSBitmapImageRep(
	bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
	bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
	colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
background.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
// The glyph fits the middle 60%, inside the circle Android cuts a maskable
// icon to.
let font = NSFont(name: "Apple Color Emoji", size: size * 0.6)!
let tree = NSAttributedString(string: "🌲", attributes: [.font: font])
let glyph = tree.size()
tree.draw(at: NSPoint(x: (size - glyph.width) / 2, y: (size - glyph.height) / 2))
NSGraphicsContext.restoreGraphicsState()
try! image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
