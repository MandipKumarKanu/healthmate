import ExpoModulesCore
import CoreGraphics
import ImageIO
import Foundation
import UniformTypeIdentifiers

/**
 * Grayscale + contrast pre-processing for OCR (iOS).
 *
 * Mirrors the Android implementation: decode at a sane size, convert to BT.601
 * luma grayscale, auto-stretch contrast to the 2nd-98th luminance percentiles,
 * and apply an adaptive gamma (dark median → brighten midtones) before
 * re-encoding a clean JPEG in the app's cache directory.
 */
public class ImageEnhancerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImageEnhancer")

    AsyncFunction("enhanceAsync") { (uri: String) -> [String: Any] in
      return try self.enhance(uri: uri)
    }
  }

  private let maxDimension: CGFloat = 2560
  private let lowPercentile = 0.02
  private let highPercentile = 0.98

  private struct EnhancedImage {
    let cgImage: CGImage
    let fileURL: URL
  }

  private func enhance(uri: String) throws -> [String: Any] {
    let sourceURL = try resolveFileURL(uri: uri)
    guard let image = downsampledImage(url: sourceURL) else {
      throw CodedException(
        "ERR_IMAGE_DECODE_FAILED",
        "Image could not be decoded: \(sourceURL.path)"
      )
    }

    let grayscaled = grayscaleWithAutoContrast(image: image)
    let fileURL = try writeJPEG(image: grayscaled, sourceURL: sourceURL)
    return [
      "uri": fileURL.absoluteString,
      "width": grayscaled.width,
      "height": grayscaled.height
    ]
  }

  /** Accepts plain paths and file:// URLs pointing at local files. */
  private func resolveFileURL(uri: String) throws -> URL {
    let fileURL: URL
    if uri.hasPrefix("file://") {
      guard let url = URL(string: uri) else {
        throw CodedException("ERR_IMAGE_NOT_FOUND", "Cannot resolve a local file path from: \(uri)")
      }
      fileURL = url
    } else if uri.hasPrefix("/") {
      fileURL = URL(fileURLWithPath: uri)
    } else {
      throw CodedException("ERR_IMAGE_NOT_FOUND", "Cannot resolve a local file path from: \(uri)")
    }
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory),
          !isDirectory.boolValue else {
      throw CodedException("ERR_IMAGE_NOT_FOUND", "File does not exist: \(fileURL.path)")
    }
    return fileURL
  }

  /** Decode-time downsample: the full-resolution bitmap never materializes. */
  private func downsampledImage(url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, [
      kCGImageSourceShouldCache: false
    ] as CFDictionary) else {
      return nil
    }
    return CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceThumbnailMaxPixelSize: maxDimension,
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary)
  }

  private func grayscaleWithAutoContrast(image: CGImage) -> CGImage {
    let width = image.width
    let height = image.height
    let colorSpace = CGColorSpaceCreateDeviceRGB()

    guard let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      return image
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let buffer = context.data else {
      return image
    }

    let pixelCount = width * height
    let pixels = buffer.bindMemory(to: UInt8.self, capacity: pixelCount * 4)

    // Pass 1: sample a luminance histogram to choose the stretch + gamma.
    var histogram = [Int](repeating: 0, count: 256)
    let stride = max(1, pixelCount / 200_000)
    var sampled = 0
    var index = 0
    while index < pixelCount {
      let offset = index * 4
      histogram[Int(luma(r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2]))] += 1
      sampled += 1
      index += stride
    }

    var lo = 0
    var hi = 255
    var median = 128
    var cumulative = 0
    var foundLow = false
    for value in 0..<256 {
      cumulative += histogram[value]
      if !foundLow && Double(cumulative) >= lowPercentile * Double(sampled) {
        lo = value
        foundLow = true
      }
      if median == 128 && Double(cumulative) >= 0.5 * Double(sampled) {
        median = value
      }
      if hi == 255
        && Double(cumulative) >= highPercentile * Double(sampled)
        && Double(sampled - cumulative) > 0.01 * Double(sampled) {
        hi = value
        break
      }
    }
    if hi - lo < 32 {
      // Degenerate range: keep grayscale but skip meaningless re-mapping.
      lo = 0
      hi = 255
    }

    let gamma: Double
    if median < 70 {
      gamma = 0.7      // Low-light label: brighten midtones.
    } else if median > 195 {
      gamma = 1.25     // Washed-out label: pull highlights down.
    } else {
      gamma = 1.0
    }

    // Pass 2: map every pixel to stretched grayscale (alpha is preserved).
    let range = max(1, hi - lo)
    let scale = 255.0 / Double(range)
    for pixelIndex in 0..<pixelCount {
      let offset = pixelIndex * 4
      var value = (Double(luma(r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2])) - Double(lo)) * scale
      value = min(255.0, max(0.0, value))
      if gamma != 1.0 {
        value = 255.0 * pow(value / 255.0, gamma)
      }
      let gray = UInt8(value.rounded())
      pixels[offset] = UInt8(Double(pixels[offset]) / 255.0 * Double(gray))
      pixels[offset + 1] = gray
      pixels[offset + 2] = gray
    }

    guard let output = context.makeImage() else {
      return image
    }
    return output
  }

  /** Integer ITU-R BT.601 luma (0..255). */
  private func luma(r: UInt8, g: UInt8, b: UInt8) -> UInt8 {
    return UInt8((77 * Int(r) + 151 * Int(g) + 28 * Int(b)) >> 8)
  }

  private func writeJPEG(image: CGImage, sourceURL: URL) throws -> URL {
    let outputDirectory = FileManager.default
      .urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ocr-enhanced", isDirectory: true)

    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    // Previous enhanced images are single-use OCR inputs; keep the directory small.
    if let leftovers = try? FileManager.default.contentsOfDirectory(at: outputDirectory, includingPropertiesForKeys: nil) {
      for leftover in leftovers {
        try? FileManager.default.removeItem(at: leftover)
      }
    }

    let fileURL = outputDirectory.appendingPathComponent("enhanced-\(Date().timeIntervalSince1970).jpg")
    guard let destination = CGImageDestinationCreateWithURL(
      fileURL as CFURL,
      UTType.jpeg.identifier as CFString,
      1,
      nil
    ) else {
      throw CodedException("ERR_IMAGE_ENCODE_FAILED", "JPEG encoder is unavailable for the enhanced image.")
    }
    CGImageDestinationAddImage(destination, image, [
      kCGImageDestinationLossyCompressionQuality: 0.92
    ] as CFDictionary)
    if !CGImageDestinationFinalize(destination) {
      throw CodedException("ERR_IMAGE_ENCODE_FAILED", "JPEG encoding failed for the enhanced image.")
    }
    return fileURL
  }
}
