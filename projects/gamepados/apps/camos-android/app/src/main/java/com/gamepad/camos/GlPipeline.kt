package com.gamepad.camos

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.graphics.Typeface
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The picture engine. The camera no longer draws straight into the video chip; it draws into this, and this draws
 * the finished picture twice: once into the video chip (what the PC gets) and once onto the phone screen.
 *
 *   camera ──► [1] turn upright + crop to the chosen shape + filter + low-light + smoothing ──► one finished frame
 *                     ├──► [2] video chip (MediaCodec), with the CamOS mark for free users
 *                     └──► [3] phone screen (TextureView), fitted, mirrored if the user wants, same mark
 *
 * New word: **OpenGL** is the phone's graphics chip. It does the turning, cropping and filters for almost no battery,
 * because the picture never leaves the graphics memory. Every phone that runs CamOS has it (OpenGL ES 2.0).
 *
 * Turning the picture upright: Android's camera service already turns each camera frame to the phone's natural
 * (upright) screen and mirrors the front camera, and hands us that as the SurfaceTexture's transform matrix (the
 * same thing that makes a TextureView preview look right). So we:
 *   1. apply that matrix (picture is now upright for a phone held in its natural way),
 *   2. undo the mirror if the matrix has one (the PC always gets the true, un-mirrored picture),
 *   3. turn the picture back by the screen's rotation (displayRotation), so it is upright however the phone is held.
 * We read the turn and the mirror from the matrix itself instead of assuming them, so odd phones still come out right.
 */
class GlPipeline(private val displayRotation: () -> Int, private val onError: (String) -> Unit) {

    companion object {
        private const val TAG = "CamOS-GL"
        /** The free-plan mark is deliberately faint (owner: "as transparent as possible"). */
        private const val MARK_ALPHA = 0.28f
    }

    // ── what the UI can change at any time (read on the GL thread every frame) ──
    @Volatile var sensorOrientation = 90   // only for the log; the matrix is what counts
    @Volatile var front = false
    @Volatile var look = 0          // 0 none, 1 warm, 2 cool, 3 vivid, 4 black & white, 5 film
    @Volatile var smooth = 0f       // 0 = off … 1 = strongest face smoothing
    @Volatile var lowLight = 0f     // 0 = off … 1 = strongest brightening
    @Volatile var watermark = true
    @Volatile var mirrorPreview = true
    @Volatile var fpsLimit = 30
    /** Pictures the camera has delivered so far (counted on the picture engine's thread). */
    @Volatile var camFrames = 0

    private val thread = HandlerThread("camos-gl").also { it.start() }
    private val handler = Handler(thread.looper)

    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var config: EGLConfig? = null
    private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
    private var encSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var prevSurface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var prevW = 0
    private var prevH = 0

    private var oesTex = 0
    var cameraTexture: SurfaceTexture? = null; private set
    private var capW = 1280
    private var capH = 720
    private var outW = 1280
    private var outH = 720
    private var fbo = 0
    private var fboTex = 0
    private var wmTex = 0
    private var wmW = 1
    private var wmH = 1

    private var camProg = 0
    private var blitProg = 0
    private val stMatrix = FloatArray(16)
    private var lastSentNs = 0L
    private var released = false

    private val quad: FloatBuffer = floatBuf(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
    private val quadTex: FloatBuffer = floatBuf(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f))

    /**
     * Set up for one stream. `encoder` is the video chip's input. Returns the camera's target (a SurfaceTexture
     * sized cap×cap) once ready, or null if the graphics chip refused.
     */
    fun start(outW: Int, outH: Int, capW: Int, capH: Int, encoder: Surface): SurfaceTexture? {
        val done = CountDownLatch(1)
        var result: SurfaceTexture? = null
        handler.post {
            try {
                this.outW = outW; this.outH = outH; this.capW = capW; this.capH = capH
                initEgl()
                encSurface = EGL14.eglCreateWindowSurface(display, config, encoder, intArrayOf(EGL14.EGL_NONE), 0)
                check(encSurface != EGL14.EGL_NO_SURFACE) { "encoder surface" }
                makeCurrent(encSurface)
                camProg = program(VS_CAM, FS_CAM)
                blitProg = program(VS_BLIT, FS_BLIT)
                oesTex = genTex(GLES11Ext.GL_TEXTURE_EXTERNAL_OES)
                makeFbo()
                makeWatermark()
                val st = SurfaceTexture(oesTex)
                st.setDefaultBufferSize(capW, capH)
                st.setOnFrameAvailableListener({ drawFrame() }, handler)
                cameraTexture = st
                result = st
            } catch (e: Throwable) {
                Log.e(TAG, "start failed", e)
                onError("The phone's graphics chip refused to start (${e.message}).")
            }
            done.countDown()
        }
        done.await(3, TimeUnit.SECONDS)
        return result
    }

    /** Where the phone screen preview goes; null removes it (app hidden, view gone). */
    fun setPreview(st: SurfaceTexture?, w: Int, h: Int) = handler.post {
        if (released || display == EGL14.EGL_NO_DISPLAY) return@post
        if (prevSurface != EGL14.EGL_NO_SURFACE) {
            makeCurrent(pbuffer)
            EGL14.eglDestroySurface(display, prevSurface)
            prevSurface = EGL14.EGL_NO_SURFACE
        }
        if (st != null) {
            prevSurface = try { EGL14.eglCreateWindowSurface(display, config, st, intArrayOf(EGL14.EGL_NONE), 0) } catch (_: Exception) { EGL14.EGL_NO_SURFACE }
            prevW = w; prevH = h
        }
    }

    fun previewResized(w: Int, h: Int) = handler.post { prevW = w; prevH = h }

    /** The camera changed lens and picture size (the output size stays the same). */
    fun setCaptureSize(w: Int, h: Int) {
        val done = CountDownLatch(1)
        handler.post { capW = w; capH = h; cameraTexture?.setDefaultBufferSize(w, h); done.countDown() }
        done.await(1, TimeUnit.SECONDS)
    }

    /** Tear everything down. The thread stays alive only until this finishes. */
    fun release() {
        val done = CountDownLatch(1)
        handler.post {
            released = true
            try {
                cameraTexture?.setOnFrameAvailableListener(null)
                cameraTexture?.release()
                cameraTexture = null
                if (display != EGL14.EGL_NO_DISPLAY) {
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                    for (s in listOf(encSurface, prevSurface, pbuffer)) if (s != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, s)
                    EGL14.eglDestroyContext(display, context)
                    EGL14.eglReleaseThread()
                    EGL14.eglTerminate(display)
                }
            } catch (_: Exception) {}
            display = EGL14.EGL_NO_DISPLAY
            done.countDown()
        }
        done.await(2, TimeUnit.SECONDS)
        thread.quitSafely()
    }

    // ───────────────────────── drawing ─────────────────────────

    private fun drawFrame() {
        if (released) return
        val st = cameraTexture ?: return
        try {
            makeCurrent(encSurface)
            st.updateTexImage()
            st.getTransformMatrix(stMatrix)
            val ts = st.timestamp
            // Every picture the camera delivers, before the frame-rate limit below: this is what the camera really
            // gives (the streamer compares it with the frame rate asked for, and tries another camera mode if short).
            camFrames++
            // Hold to the chosen frame rate even if the camera runs faster.
            val interval = 1_000_000_000L / max(1, fpsLimit)
            if (lastSentNs != 0L && ts - lastSentNs < interval * 3 / 4) return
            lastSentNs = ts

            // [1] camera → finished frame (fbo)
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
            GLES20.glViewport(0, 0, outW, outH)
            drawCamera()
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)

            // [2] finished frame → video chip
            GLES20.glViewport(0, 0, outW, outH)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            blit(fboTex, -1f, -1f, 1f, 1f, flipX = false, flipY = false, alpha = 1f)
            if (watermark) drawMark(-1f, -1f, 1f, 1f, outH)
            EGLExt.eglPresentationTimeANDROID(display, encSurface, ts)
            EGL14.eglSwapBuffers(display, encSurface)

            // [3] finished frame → phone screen, fitted inside the view with the same shape the PC gets
            if (prevSurface != EGL14.EGL_NO_SURFACE && prevW > 0 && prevH > 0) {
                makeCurrent(prevSurface)
                EGL14.eglSwapInterval(display, 0)
                GLES20.glViewport(0, 0, prevW, prevH)
                GLES20.glClearColor(0f, 0f, 0f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                val k = min(prevW.toFloat() / outW, prevH.toFloat() / outH)
                val hx = outW * k / prevW
                val hy = outH * k / prevH
                blit(fboTex, -hx, -hy, hx, hy, flipX = front && mirrorPreview, flipY = false, alpha = 1f)
                if (watermark) drawMark(-hx, -hy, hx, hy, (outH * k).toInt())
                EGL14.eglSwapBuffers(display, prevSurface)
            }
        } catch (e: Throwable) {
            Log.w(TAG, "frame failed", e)
        }
    }

    private fun drawCamera() {
        GLES20.glUseProgram(camProg)
        // What Android's matrix already did: a quarter turn swaps the picture's width and height, and a mirror shows
        // up as a positive determinant (a plain SurfaceTexture matrix has a vertical flip, so its determinant is −1).
        val m = stMatrix
        val quarterTurned = abs(m[0]) < 0.5f
        val mirrored = m[0] * m[5] - m[1] * m[4] > 0f
        val natW = if (quarterTurned) capH else capW
        val natH = if (quarterTurned) capW else capH
        // Turn back by the screen rotation: counter-clockwise on screen (as Android's own Camera2 sample does).
        val disp = displayRotation()
        val r = Math.toRadians(disp.toDouble())
        val c = cos(r).toFloat(); val s = sin(r).toFloat()
        val sideways = disp == 90 || disp == 270
        val rx = if (sideways) natH else natW
        val ry = if (sideways) natW else natH
        // Scale so the picture fills the output without stretching (the overflow is cropped).
        val k = max(outW.toFloat() / rx, outH.toFloat() / ry)
        val sx = rx * k / outW
        val sy = ry * k / outH
        GLES20.glUniformMatrix2fv(GLES20.glGetUniformLocation(camProg, "uRot"), 1, false, floatArrayOf(c, s, -s, c), 0)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(camProg, "uScale"), sx, sy)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(camProg, "uFlipX"), if (mirrored) -1f else 1f)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(camProg, "uSt"), 1, false, stMatrix, 0)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(camProg, "uLook"), look)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(camProg, "uSmooth"), smooth)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(camProg, "uLift"), lowLight)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(camProg, "uTexel"), 1f / capW, 1f / capH)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(camProg, "uTex"), 0)
        drawQuad(camProg)
    }

    /** The CamOS mark: bottom-right corner of the picture rectangle (clip coordinates), ~4.5 % of its height, faint.
     *  The rectangle always has the output's shape, so its width in pixels is pixelsHigh × outW / outH. */
    private fun drawMark(x0: Float, y0: Float, x1: Float, y1: Float, pixelsHigh: Int) {
        val rectPxH = max(1f, pixelsHigh.toFloat())
        val rectPxW = rectPxH * outW / outH
        val markPxH = rectPxH * 0.045f
        val markPxW = markPxH * wmW / wmH
        val marginPx = markPxH * 0.6f
        val right = x1 - (x1 - x0) * marginPx / rectPxW
        val left = right - (x1 - x0) * markPxW / rectPxW
        val bottom = y0 + (y1 - y0) * marginPx / rectPxH
        val top = bottom + (y1 - y0) * markPxH / rectPxH
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        blit(wmTex, left, bottom, right, top, flipX = false, flipY = true, alpha = MARK_ALPHA)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun blit(tex: Int, x0: Float, y0: Float, x1: Float, y1: Float, flipX: Boolean, flipY: Boolean, alpha: Float) {
        GLES20.glUseProgram(blitProg)
        GLES20.glUniform4f(GLES20.glGetUniformLocation(blitProg, "uRect"), x0, y0, x1, y1)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(blitProg, "uFlip"), if (flipX) 1f else 0f, if (flipY) 1f else 0f)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(blitProg, "uAlpha"), alpha)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(blitProg, "uTex"), 0)
        drawQuad(blitProg)
    }

    private fun drawQuad(prog: Int) {
        val aPos = GLES20.glGetAttribLocation(prog, "aPos")
        val aTex = GLES20.glGetAttribLocation(prog, "aTex")
        GLES20.glEnableVertexAttribArray(aPos)
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glEnableVertexAttribArray(aTex)
        GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 0, quadTex)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(aPos)
        GLES20.glDisableVertexAttribArray(aTex)
    }

    // ───────────────────────── setup helpers ─────────────────────────

    private fun initEgl() {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val v = IntArray(2)
        check(EGL14.eglInitialize(display, v, 0, v, 1)) { "eglInitialize" }
        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
            0x3142, 1, // EGL_RECORDABLE_ANDROID: allowed to draw into the video chip
            EGL14.EGL_NONE)
        val configs = arrayOfNulls<EGLConfig>(1)
        val n = IntArray(1)
        check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, n, 0) && n[0] > 0) { "eglChooseConfig" }
        config = configs[0]
        context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext" }
        pbuffer = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    }

    private fun makeCurrent(s: EGLSurface) {
        EGL14.eglMakeCurrent(display, s, s, context)
    }

    private fun genTex(target: Int): Int {
        val t = IntArray(1)
        GLES20.glGenTextures(1, t, 0)
        GLES20.glBindTexture(target, t[0])
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return t[0]
    }

    private fun makeFbo() {
        fboTex = genTex(GLES20.GL_TEXTURE_2D)
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, outW, outH, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        val f = IntArray(1)
        GLES20.glGenFramebuffers(1, f, 0)
        fbo = f[0]
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, fboTex, 0)
        check(GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER) == GLES20.GL_FRAMEBUFFER_COMPLETE) { "framebuffer" }
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
    }

    /** "CamOS" in white with a soft shadow, drawn once into a texture (premultiplied alpha). */
    private fun makeWatermark() {
        val textPx = 64f
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = textPx
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            setShadowLayer(4f, 0f, 1f, Color.argb(90, 0, 0, 0))   // just enough to read on a white wall
        }
        val label = "CamOS"
        val w = (p.measureText(label) + 24).toInt()
        val h = (textPx * 1.4f).toInt()
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawText(label, 12f, textPx * 1.05f, p)
        wmTex = genTex(GLES20.GL_TEXTURE_2D)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
        wmW = w; wmH = h
        bmp.recycle()
    }

    private fun program(vs: String, fs: String): Int {
        fun shader(type: Int, src: String): Int {
            val s = GLES20.glCreateShader(type)
            GLES20.glShaderSource(s, src)
            GLES20.glCompileShader(s)
            val ok = IntArray(1)
            GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
            check(ok[0] != 0) { "shader: " + GLES20.glGetShaderInfoLog(s) }
            return s
        }
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs))
        GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs))
        GLES20.glLinkProgram(p)
        val ok = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { "link: " + GLES20.glGetProgramInfoLog(p) }
        return p
    }

    private fun floatBuf(a: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }
}

private const val VS_CAM = """
attribute vec2 aPos;
attribute vec2 aTex;
uniform mat4 uSt;
uniform mat2 uRot;
uniform vec2 uScale;
uniform float uFlipX;
varying vec2 vTex;
void main() {
    vec2 p = (uRot * vec2(aPos.x * uFlipX, aPos.y)) * uScale;
    gl_Position = vec4(p, 0.0, 1.0);
    vTex = (uSt * vec4(aTex, 0.0, 1.0)).xy;
}
"""

// Filters. Looks are simple colour maths; face smoothing is an edge-keeping blur (it softens skin but keeps eyes,
// hair and outlines sharp, because pixels that differ a lot from the centre get almost no weight); low-light lifts
// the shadows more than the highlights.
private const val FS_CAM = """
#extension GL_OES_EGL_image_external : require
precision mediump float;
varying vec2 vTex;
uniform samplerExternalOES uTex;
uniform int uLook;
uniform float uSmooth;
uniform float uLift;
uniform vec2 uTexel;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
void main() {
    vec3 c = texture2D(uTex, vTex).rgb;
    if (uSmooth > 0.0) {
        vec3 sum = c;
        float wsum = 1.0;
        float r = 1.5 + 3.0 * uSmooth;
        for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5235988;
            float ring = (i < 6) ? 1.0 : 2.0;
            vec2 o = vec2(cos(a + ring * 0.26), sin(a + ring * 0.26)) * uTexel * r * ring;
            vec3 s = texture2D(uTex, vTex + o).rgb;
            vec3 d = s - c;
            float w = exp(-dot(d, d) * 90.0);
            sum += s * w;
            wsum += w;
        }
        c = mix(c, sum / wsum, 0.35 + 0.6 * uSmooth);
    }
    if (uLift > 0.0) {
        c = pow(max(c, 0.0), vec3(1.0 / (1.0 + 0.9 * uLift)));
        c *= 1.0 + 0.15 * uLift;
    }
    if (uLook == 1) { c = c * vec3(1.07, 1.0, 0.88) + vec3(0.02, 0.01, 0.0); }
    else if (uLook == 2) { c = c * vec3(0.9, 0.99, 1.1); }
    else if (uLook == 3) { c = sat((c - 0.5) * 1.08 + 0.5, 1.35); }
    else if (uLook == 4) { float l = luma(c); c = vec3(clamp((l - 0.5) * 1.12 + 0.5, 0.0, 1.0)); }
    else if (uLook == 5) { c = sat(c, 0.82); c = mix(c, vec3(luma(c)) * vec3(1.07, 0.99, 0.86), 0.18); c = c * 0.9 + 0.06; }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
"""

private const val VS_BLIT = """
attribute vec2 aPos;
attribute vec2 aTex;
uniform vec4 uRect;
uniform vec2 uFlip;
varying vec2 vTex;
void main() {
    vec2 p = mix(uRect.xy, uRect.zw, aPos * 0.5 + 0.5);
    gl_Position = vec4(p, 0.0, 1.0);
    vTex = vec2(uFlip.x > 0.5 ? 1.0 - aTex.x : aTex.x, uFlip.y > 0.5 ? 1.0 - aTex.y : aTex.y);
}
"""

private const val FS_BLIT = """
precision mediump float;
varying vec2 vTex;
uniform sampler2D uTex;
uniform float uAlpha;
void main() { gl_FragColor = texture2D(uTex, vTex) * uAlpha; }
"""
