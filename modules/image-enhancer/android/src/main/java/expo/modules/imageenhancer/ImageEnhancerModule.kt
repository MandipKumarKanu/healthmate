package expo.modules.imageenhancer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Grayscale + contrast pre-processing for OCR (Android).
 *
 * Medicine labels photographed in low light or with washed-out exposure read
 * poorly by ML Kit before any histogram normalization. This module decodes a
 * photo at a sane size, converts it to luma grayscale, auto-stretches the
 * contrast to the 2nd-98th luminance percentiles, and applies an adaptive
 * gamma (dark median → brighten midtones, high median → pull highlights down)
 * before re-encoding a clean JPEG for the recognizer.
 */
class ImageEnhancerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ImageEnhancer")

    AsyncFunction("enhanceAsync") { uri: String ->
      return@AsyncFunction enhance(uri)
    }
  }

  /** Decode cap so the enhancement never materializes a 12MP bitmap. */
  private val maxDimension = 2560

  /** Percentile bounds of the auto-contrast stretch. */
  private val lowPercentile = 0.02
  private val highPercentile = 0.98

  private fun enhance(uri: String): Map<String, Any> {
    val sourceFile = resolveFile(uri)
      ?: throw CodedException(code = "ERR_IMAGE_NOT_FOUND", message = "Cannot resolve a local file path from: $uri", cause = null)
    val bitmap = decodeBitmap(sourceFile)
      ?: throw CodedException(code = "ERR_IMAGE_DECODE_FAILED", message = "Image could not be decoded: $sourceFile", cause = null)

    try {
      applyGrayscaleAndContrast(bitmap)
      val outFile = writeJpeg(bitmap)
      return mapOf(
        "uri" to "file://${outFile.absolutePath}",
        "width" to bitmap.width,
        "height" to bitmap.height
      )
    } finally {
      bitmap.recycle()
    }
  }

  /** Accepts plain paths and file:// URIs pointing at local files. */
  private fun resolveFile(uri: String): File? {
    val path = if (uri.startsWith("file://")) {
      uri.removePrefix("file://")
    } else {
      uri
    }
    if (path.isEmpty()) return null
    val file = File(path)
    return if (file.exists()) file else null
  }

  private fun decodeBitmap(file: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = computeSampleSize(bounds.outWidth, bounds.outHeight)
      inJustDecodeBounds = false
    }
    return BitmapFactory.decodeFile(file.absolutePath, options)
  }

  /** Largest power-of-two sample size whose long edge stays <= maxDimension. */
  private fun computeSampleSize(width: Int, height: Int): Int {
    var sampleSize = 1
    var longEdge = max(width, height)
    while (longEdge / 2 >= maxDimension) {
      sampleSize *= 2
      longEdge /= 2
    }
    return sampleSize
  }

  private fun applyGrayscaleAndContrast(bitmap: Bitmap) {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return

    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

    // Pass 1: sample a luminance histogram to choose the stretch + gamma.
    val histogram = IntArray(256)
    val stride = max(1, (width * height) / 200_000)
    var sampled = 0
    var i = 0
    while (i < pixels.size) {
      val luma = lumaOf(pixels[i])
      histogram[luma]++
      sampled++
      i += stride
    }

    var lo = 0
    var hi = 255
    var median = 128
    var cumulative = 0
    var foundLow = false
    for (v in histogram.indices) {
      cumulative += histogram[v]
      if (!foundLow && cumulative >= lowPercentile * sampled) {
        lo = v
        foundLow = true
      }
      if (median == 128 && cumulative >= 0.5 * sampled) {
        median = v
      }
      if (hi == 255 && cumulative >= highPercentile * sampled && sampled - cumulative > 0.01 * sampled) {
        hi = v
        break
      }
    }
    if (hi - lo < 32) {
      // An already-full-range (or flat) image stretches into itself; still
      // grayscale it, but skip meaningless re-mapping of a degenerate range.
      lo = 0
      hi = 255
    }

    // Dark read (low-light label): brighten midtones. Washed-out read: pull
    // them down. Neutral median stays gamma-1.
    val gamma = when {
      median < 70 -> 0.7
      median > 195 -> 1.25
      else -> 1.0
    }

    // Pass 2: map every pixel to stretched grayscale.
    val range = max(1, hi - lo)
    val scale = 255.0 / range
    for (index in pixels.indices) {
      val pixel = pixels[index]
      var value = (lumaOf(pixel) - lo) * scale
      value = min(255.0, max(0.0, value))
      if (gamma != 1.0) {
        value = 255.0 * (value / 255.0).pow(gamma)
      }
      val gray = value.toInt().coerceIn(0, 255)
      pixels[index] = Color.argb(Color.alpha(pixel), gray, gray, gray)
    }
    bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
  }

  /** Integer ITU-R BT.601 luma (0..255). */
  private fun lumaOf(pixel: Int): Int {
    val r = Color.red(pixel)
    val g = Color.green(pixel)
    val b = Color.blue(pixel)
    return (77 * r + 151 * g + 28 * b) shr 8
  }

  private fun writeJpeg(bitmap: Bitmap): File {
    val cacheDirectory = appContext.cacheDirectory
      ?: throw CodedException(code = "ERR_NO_CONTEXT", message = "Cache directory is unavailable for image enhancement.", cause = null)

    val outputDirectory = File(cacheDirectory, "ocr-enhanced").apply {
      if (!exists()) mkdirs()
    }
    // Previous enhanced images are single-use OCR inputs; keep the directory small.
    outputDirectory.listFiles()?.forEach { it.delete() }

    val outputFile = File(outputDirectory, "enhanced-${System.currentTimeMillis()}.jpg")
    FileOutputStream(outputFile).use { stream ->
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, stream)) {
        throw CodedException(code = "ERR_IMAGE_ENCODE_FAILED", message = "JPEG encoding failed for the enhanced image.", cause = null)
      }
    }
    return outputFile
  }
}
