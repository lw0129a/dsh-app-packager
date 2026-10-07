import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func rgba(from hex: String) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
    var value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    if value.count == 6 { value += "FF" }
    var number: UInt64 = 0
    Scanner(string: value).scanHexInt64(&number)
    return (
        CGFloat((number >> 24) & 0xFF) / 255.0,
        CGFloat((number >> 16) & 0xFF) / 255.0,
        CGFloat((number >> 8) & 0xFF) / 255.0,
        CGFloat(number & 0xFF) / 255.0
    )
}

func render(sourcePath: String, outputPath: String, width: Int, height: Int, maxLogoWidth: CGFloat, maxLogoHeight: CGFloat, backgroundHex: String) throws {
    let sourceURL = URL(fileURLWithPath: sourcePath) as CFURL
    guard let source = CGImageSourceCreateWithURL(sourceURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "BrandAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot load image: \(sourcePath)"])
    }

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.noneSkipLast.rawValue
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        throw NSError(domain: "BrandAssets", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot create context"])
    }

    let (r, g, b, a) = rgba(from: backgroundHex)
    context.setFillColor(CGColor(red: r, green: g, blue: b, alpha: a))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high

    let sourceWidth = CGFloat(image.width)
    let sourceHeight = CGFloat(image.height)
    let scale = min(maxLogoWidth / sourceWidth, maxLogoHeight / sourceHeight)
    let drawWidth = sourceWidth * scale
    let drawHeight = sourceHeight * scale
    let drawRect = CGRect(
        x: (CGFloat(width) - drawWidth) / 2.0,
        y: (CGFloat(height) - drawHeight) / 2.0,
        width: drawWidth,
        height: drawHeight
    )
    context.draw(image, in: drawRect)

    guard let output = context.makeImage() else {
        throw NSError(domain: "BrandAssets", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot create output image"])
    }
    let outputURL = URL(fileURLWithPath: outputPath) as CFURL
    guard let destination = CGImageDestinationCreateWithURL(outputURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "BrandAssets", code: 4, userInfo: [NSLocalizedDescriptionKey: "Cannot create PNG destination"])
    }
    CGImageDestinationAddImage(destination, output, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw NSError(domain: "BrandAssets", code: 5, userInfo: [NSLocalizedDescriptionKey: "Cannot write PNG"])
    }
}

let args = CommandLine.arguments
guard args.count == 5 else {
    fputs("Usage: make-brand-assets.swift <icon-source> <splash-source> <output-dir> <background-hex>\n", stderr)
    exit(2)
}

autoreleasepool {
    do {
        let iconSource = args[1]
        let splashSource = args[2]
        let outputDir = args[3]
        let background = args[4]
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let iconSizes: [(String, Int)] = [
            ("icon-1024.png", 1024),
            ("icon-xxxhdpi.png", 192),
            ("icon-xxhdpi.png", 144),
            ("icon-xhdpi.png", 96),
            ("icon-hdpi.png", 72),
            ("icon-mdpi.png", 48),
        ]

        for (name, size) in iconSizes {
            let inset = CGFloat(size) * 0.11
            try render(
                sourcePath: iconSource,
                outputPath: "\(outputDir)/\(name)",
                width: size,
                height: size,
                maxLogoWidth: CGFloat(size) - inset * 2.0,
                maxLogoHeight: CGFloat(size) - inset * 2.0,
                backgroundHex: background
            )
        }

        try render(
            sourcePath: splashSource,
            outputPath: "\(outputDir)/launch-logo.png",
            width: 384,
            height: 384,
            maxLogoWidth: 280,
            maxLogoHeight: 280,
            backgroundHex: background
        )

        try render(
            sourcePath: splashSource,
            outputPath: "\(outputDir)/splash-ios.png",
            width: 1242,
            height: 2688,
            maxLogoWidth: 500,
            maxLogoHeight: 500,
            backgroundHex: background
        )

        print(outputDir)
    } catch {
        fputs("\(error)\n", stderr)
        exit(1)
    }
}
