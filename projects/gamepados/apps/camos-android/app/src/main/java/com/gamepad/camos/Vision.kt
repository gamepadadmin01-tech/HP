package com.gamepad.camos

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The phone's "eyes" for two Premium filters (owner, 2026-11-23), on their own thread so they never slow a frame:
 *
 *  - **Background blur**: Google's MediaPipe selfie-segmenter model (assets/models/selfie_segmenter.tflite) run by
 *    MediaPipe Tasks gives, for every pixel of a small copy of the picture, how sure it is that it's a person (0…1).
 *    The picture engine blurs where it isn't.
 *  - **Auto-framing**: ML Kit face detection (from Google Play services) finds the faces; the picture engine zooms
 *    gently to keep them framed.
 *
 * The picture engine hands over a small upright copy (256 px wide) about 10 times a second, only when the previous
 * one is done. Results are kept here for the engine to pick up on its next frame. If a part can't start (no Play
 * services, model problem), that filter just does nothing; streaming is never affected.
 */
class Vision(private val context: Context) {
    companion object {
        private const val TAG = "CamOS-Vision"
        private const val MODEL = "models/selfie_segmenter.tflite"
    }

    /** A person mask: `w`×`h` bytes, 0 = background … 255 = person, top row first. */
    class Mask(val w: Int, val h: Int, val bytes: ByteArray, val seq: Int)

    /** Faces as fractions of the small copy (0…1, top-left origin), and the picture engine's crop at that moment. */
    class Faces(val boxes: List<FloatArray>, val crop: FloatArray, val atMs: Long)

    private val thread = HandlerThread("camos-vision").also { it.start() }
    private val handler = Handler(thread.looper)
    private val busy = AtomicBoolean(false)
    private var segmenter: ImageSegmenter? = null
    private var segFailed = false
    /** The person model runs on the graphics chip (for the log). */
    @Volatile var onGpu = false; private set
    private var prevMask: FloatArray? = null
    private var faceDetector: FaceDetector? = null
    private var faceFailed = false
    private var maskSeq = 0
    private var looks = 0
    @Volatile private var closed = false

    @Volatile var mask: Mask? = null; private set
    @Volatile var faces: Faces? = null; private set
    /** Average time per analysis (ms), for the log. */
    @Volatile var costMs = 0f; private set

    /** Free to take a new picture? (The engine skips handing one over while the last is still being looked at.) */
    fun idle() = !busy.get() && !closed

    /**
     * Look at one small upright picture (RGBA, `w`×`h`, top row first). `wantMask` / `wantFaces` say which filters are
     * on; `crop` is the engine's auto-framing crop when the picture was taken (to map faces back).
     */
    fun submit(rgba: ByteBuffer, w: Int, h: Int, wantMask: Boolean, wantFaces: Boolean, crop: FloatArray) {
        if (!busy.compareAndSet(false, true)) return
        handler.post {
            val t0 = SystemClock.elapsedRealtime()
            try {
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                rgba.rewind()
                bmp.copyPixelsFromBuffer(rgba)
                if (wantMask && !segFailed) runMask(bmp) else if (!wantMask) { mask = null; prevMask = null }
                // Faces move slowly: look for them every 3rd picture (~2.5 times a second) to save battery and heat.
                if (wantFaces && !faceFailed && (looks++ % 3 == 0 || !wantMask)) runFaces(bmp, w, h, crop) else if (!wantFaces) faces = null
                bmp.recycle()
            } catch (e: Throwable) {
                Log.w(TAG, "analysis failed: ${e.message}")
            } finally {
                val dt = (SystemClock.elapsedRealtime() - t0).toFloat()
                costMs = if (costMs == 0f) dt else costMs * 0.9f + dt * 0.1f
                busy.set(false)
            }
        }
    }

    private fun runMask(bmp: Bitmap) {
        // On the graphics chip if it can (much less processor time, so a cooler phone); otherwise the processor.
        fun make(d: Delegate) = ImageSegmenter.createFromOptions(context,
            ImageSegmenter.ImageSegmenterOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL).setDelegate(d).build())
                .setRunningMode(RunningMode.IMAGE)
                .setOutputConfidenceMasks(true)
                .setOutputCategoryMask(false)
                .build())
        val seg = segmenter ?: try {
            make(Delegate.GPU).also { segmenter = it; onGpu = true; Log.i(TAG, "person model ready (graphics chip)") }
        } catch (e: Throwable) {
            Log.w(TAG, "person model on the graphics chip refused (${e.message}); processor instead")
            try {
                make(Delegate.CPU).also { segmenter = it; onGpu = false; Log.i(TAG, "person model ready (processor)") }
            } catch (e2: Throwable) {
                Log.w(TAG, "person model unavailable: ${e2.message}")
                segFailed = true
                return
            }
        }
        val result = seg.segment(BitmapImageBuilder(bmp).build())
        val masks = result.confidenceMasks().orElse(null)
        if (maskSeq < 3) Log.i(TAG, "segment: ${masks?.size ?: -1} masks ${masks?.firstOrNull()?.let { "${it.width}x${it.height}" } ?: ""}")
        if (masks == null || masks.isEmpty()) return
        val m = masks[masks.size - 1]   // the selfie model has one mask: "person"
        val w = m.width; val h = m.height
        val fb = ByteBufferExtractor.extract(m).order(ByteOrder.nativeOrder()).asFloatBuffer()
        val n = w * h
        // Steadier edges: blend with the previous mask (the person rarely jumps between two looks 0.1 s apart).
        val prev = prevMask?.takeIf { p -> p.size == n }
        val cur = FloatArray(n)
        for (i in 0 until n) {
            val v = fb.get(i).coerceIn(0f, 1f)
            cur[i] = if (prev != null) v * 0.65f + prev[i] * 0.35f else v
        }
        prevMask = cur
        val bytes = ByteArray(n) { i -> (cur[i] * 255f).toInt().toByte() }
        mask = Mask(w, h, bytes, ++maskSeq)
        if (maskSeq <= 3) Log.i(TAG, "mask #$maskSeq ${w}x$h, middle value ${bytes[n / 2].toInt() and 0xff}")
    }

    private fun runFaces(bmp: Bitmap, w: Int, h: Int, crop: FloatArray) {
        val det = faceDetector ?: try {
            FaceDetection.getClient(
                FaceDetectorOptions.Builder()
                    .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                    .setMinFaceSize(0.08f)
                    .build()).also { faceDetector = it }
        } catch (e: Throwable) {
            Log.w(TAG, "face detection unavailable: ${e.message}")
            faceFailed = true
            return
        }
        val found = try { Tasks.await(det.process(InputImage.fromBitmap(bmp, 0))) } catch (e: Exception) {
            // Play services still downloading its face model, or missing: try again later, don't spam.
            Log.w(TAG, "face detection: ${e.message}")
            return
        }
        val boxes = found.map { f ->
            val b = f.boundingBox
            floatArrayOf(b.left.toFloat() / w, b.top.toFloat() / h, b.right.toFloat() / w, b.bottom.toFloat() / h)
        }
        faces = Faces(boxes, crop, SystemClock.elapsedRealtime())
    }

    fun close() {
        closed = true
        handler.post {
            try { segmenter?.close() } catch (_: Exception) {}
            try { faceDetector?.close() } catch (_: Exception) {}
            thread.quitSafely()
        }
    }
}
