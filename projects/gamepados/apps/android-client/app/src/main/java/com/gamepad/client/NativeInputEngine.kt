package com.gamepad.client

import android.annotation.SuppressLint
import android.os.SystemClock
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PHASE 3 — native touch input path.
 *
 * Measured 2026-07-20 (GPM harness): touch→JS dispatch is ~6.8 ms avg / 15 ms p95
 * — 78% of the one-way input path and ~2.7× the entire network round-trip. This
 * engine takes input off the WebView entirely: an invisible full-screen overlay
 * View sits ABOVE the WebView, hit-tests touches against the pad geometry the JS
 * side publishes (design-space coords + the SVG's screen matrix), keeps
 * button/stick/trigger state natively, merges the gyro from the fused sensor
 * (MainActivity.fusedRollDeg/PitchDeg — same math as App.tsx's packet builder),
 * builds the 20-byte payload and injects it straight into the C++ TX thread.
 * JS never runs on the input path; it only receives coalesced pressed-state
 * once per frame for visuals (window.__nvis).
 *
 * The wire format, injectNativePayload JNI and the C++ engine are UNTOUCHED —
 * this layer replaces only the JS packet builder, byte-for-byte:
 *   • hair-trigger rescale  min(1, fill/0.85) → 0..255
 *   • stick radial deadzone 8% of 60 design units, rescaled to the rim
 *   • gyro applied AFTER the stick deadzone (racing → LS-X [/LS-Y with
 *     throttle], 3d → RS-X/RS-Y, same signs as App.tsx ~line 1030)
 *   • axis byte = round(128 + norm*127)
 *   • timestamp/authToken are 0 — the C++ TX thread overwrites both every send.
 *
 * Touch routing: the overlay declines (returns false for) any gesture whose
 * first touch misses every widget or starts inside a JS-published exclusion
 * rect (HUD buttons), so those go to the WebView natively. Extra pointers that
 * land while the overlay already owns a gesture are force-merged onto it by
 * ViewGroup dispatch — if such a pointer misses all widgets it is replayed into
 * the page as a synthetic tap on release, so HUD taps still work mid-play.
 *
 * Everything is behind the JS feature flag (localStorage gp_native_input,
 * window.__setNativeInput) — with the overlay inactive the app behaves exactly
 * as before this change.
 */
class NativeInputEngine(private val activity: MainActivity) {

    // ── Widget kinds (flattened by the JS exporter — see buildNativeGeometry) ──
    private companion object {
        const val K_BTN = 0; const val K_DPAD = 1; const val K_STICK = 2
        const val K_TRIG = 3; const val K_MODE = 4
        const val STICK_MAX_R = 60f          // useStick(60): knob travel in design units
        const val STICK_DEADZONE = 0.08f * 60f  // processStick: 8% of 60
        const val TRIG_THRESHOLD = 0.85f     // hair-trigger: (100-15)/100
    }

    private class Widget(
        val kind: Int,
        val x: Float, val y: Float, val r: Float, val w: Float, val h: Float,
        val rect: Boolean,                   // btn only: rect vs circle hit shape
        val bits: Int,                       // btn: pre-resolved button bits (macro = several)
        val bitsUp: Int, val bitsDown: Int, val bitsLeft: Int, val bitsRight: Int,
        val vis: String,                     // visual key fed back to JS (uid / "LT"/"RT")
        val visUp: String, val visDown: String, val visLeft: String, val visRight: String,
        val which: Char,                     // stick: 'L' / 'R' / 'H'(ybrid)
        val sideLeft: Boolean,               // trig: LT vs RT
        val digital: Boolean,                // trig: tap = instant 100%, no feathering
        val std: Boolean,                    // trig: vis belongs to the standard held set
        val mode: Char,                      // mode selector: 'L' / 'R'
        val hap: String                      // press-haptic tier ("" = off)
    )

    private class Binding(val widget: Widget) {
        var dirUp = false; var dirDown = false; var dirLeft = false; var dirRight = false
        var atRim = false                    // stick edge-tick re-arm
        // Hybrid sticks resolve L/R at PRESS time so a mid-hold mode switch can
        // never strand the previous side deflected.
        var stickLeft = true
        var inert = false                    // duplicate finger on a stick/dpad — JS ignores it too
        // forward-tap candidates (merged pointer that hit nothing):
        var fwdCssX = 0f; var fwdCssY = 0f; var fwdDownMs = 0L; var fwdMoved = false
    }

    private val lock = Any()

    // Geometry (guarded by lock)
    private var widgets: Array<Widget> = emptyArray()
    private var exclusions: FloatArray = FloatArray(0)   // css-px rects, packed x,y,w,h
    private var dpr = 1f
    // design→CSS matrix inverse (from svg.getScreenCTM): design = Minv · css
    private var ia = 1f; private var ib = 0f; private var ic = 0f
    private var id = 1f; private var ie = 0f; private var iff = 0f
    private var haveMatrix = false

    // Input state (guarded by lock)
    @Volatile private var active = false
    private val bindings = HashMap<Int, Binding>()       // pointerId → binding
    private var buttonsMask = 0
    private var ltFill = 0f; private var rtFill = 0f
    private var lsX = 0f; private var lsY = 0f           // design units, ±60
    private var rsX = 0f; private var rsY = 0f
    private var stickMode = 'L'

    // Gyro config (pushed from JS; zero captured natively on calibrate)
    @Volatile private var gyroOn = false
    @Volatile private var gyroMode3d = false
    @Volatile private var gyroSensDeg = 45f
    @Volatile private var gyroDzDeg = 0f
    @Volatile private var gyroThrottle = false
    @Volatile private var gyroHaptic = false
    @Volatile private var hapticsEnabled = true
    @Volatile private var gyroZeroX = 0f
    @Volatile private var gyroZeroY = 0f
    private var gyroWasMax = false

    // Reused payload buffer — only ever written under `lock`.
    private val payload = ByteArray(20)

    // ── GPM: native touch→handle latency (the segment JS GPM can no longer see) ──
    private val gpmSamples = ArrayList<Float>(512)
    private var gpmLastLog = 0L

    // ── Visual feedback → JS, coalesced to one evaluateJavascript per frame ──
    private var visScheduled = false
    private var lastVisJson = ""
    private val visHeldCustom = LinkedHashSet<String>()
    private val visHeldStd = LinkedHashSet<String>()
    private val visCallback = Choreographer.FrameCallback {
        visScheduled = false
        pushVisuals()
    }

    /** Invisible full-screen touch layer. Sits above the WebView in gameContainer. */
    val overlay: View = @SuppressLint("ViewConstructor") object : View(activity) {
        init {
            setWillNotDraw(true)
            visibility = View.GONE
        }
        override fun performClick(): Boolean { super.performClick(); return true }
        override fun onTouchEvent(ev: MotionEvent): Boolean = handleTouch(ev)
    }

    // ═══════════════════════════ Bridge entry points ═══════════════════════════

    /** Parse + store the pad geometry JS published. Clears any in-flight touches. */
    fun setGeometry(json: String) {
        val o = JSONObject(json)
        val m = o.getJSONArray("matrix")
        val a = m.getDouble(0).toFloat(); val b = m.getDouble(1).toFloat()
        val c = m.getDouble(2).toFloat(); val d = m.getDouble(3).toFloat()
        val e = m.getDouble(4).toFloat(); val f = m.getDouble(5).toFloat()
        val det = a * d - b * c
        val exArr = o.optJSONArray("exclusions") ?: JSONArray()
        val ex = FloatArray(exArr.length() * 4)
        for (i in 0 until exArr.length()) {
            val r = exArr.getJSONObject(i)
            ex[i * 4] = r.getDouble("x").toFloat(); ex[i * 4 + 1] = r.getDouble("y").toFloat()
            ex[i * 4 + 2] = r.getDouble("w").toFloat(); ex[i * 4 + 3] = r.getDouble("h").toFloat()
        }
        val wArr = o.getJSONArray("widgets")
        val ws = ArrayList<Widget>(wArr.length())
        for (i in 0 until wArr.length()) {
            val w = wArr.getJSONObject(i)
            val kind = when (w.getString("k")) {
                "dpad" -> K_DPAD; "stick" -> K_STICK; "trig" -> K_TRIG; "mode" -> K_MODE; else -> K_BTN
            }
            val bitsObj = if (kind == K_DPAD) w.getJSONObject("bits") else null
            val visObj = if (kind == K_DPAD) w.getJSONObject("vis") else null
            ws.add(Widget(
                kind = kind,
                x = w.getDouble("x").toFloat(), y = w.getDouble("y").toFloat(),
                r = w.optDouble("r", 0.0).toFloat(),
                w = w.optDouble("w", 0.0).toFloat(), h = w.optDouble("h", 0.0).toFloat(),
                rect = w.optString("shape") == "rect",
                bits = w.optInt("bits", 0),
                bitsUp = bitsObj?.optInt("up") ?: 0, bitsDown = bitsObj?.optInt("down") ?: 0,
                bitsLeft = bitsObj?.optInt("left") ?: 0, bitsRight = bitsObj?.optInt("right") ?: 0,
                vis = w.optString("vis", ""),
                visUp = visObj?.optString("up") ?: "", visDown = visObj?.optString("down") ?: "",
                visLeft = visObj?.optString("left") ?: "", visRight = visObj?.optString("right") ?: "",
                which = (w.optString("which", "L").firstOrNull() ?: 'L'),
                sideLeft = w.optString("side") == "L",
                digital = w.optBoolean("digital", false),
                std = w.optBoolean("std", false),
                mode = (w.optString("mode", "L").firstOrNull() ?: 'L'),
                hap = w.optString("hap", "")
            ))
        }
        synchronized(lock) {
            widgets = ws.toTypedArray()
            exclusions = ex
            dpr = o.optDouble("dpr", 1.0).toFloat().coerceAtLeast(0.1f)
            if (det != 0f) {
                ia = d / det; ib = -b / det; ic = -c / det; id = a / det
                ie = (c * f - d * e) / det; iff = (b * e - a * f) / det
                haveMatrix = true
            } else haveMatrix = false
            stickMode = (o.optString("stickMode", stickMode.toString()).firstOrNull() ?: 'L')
            hapticsEnabled = o.optBoolean("hapticsEnabled", hapticsEnabled)
            clearAllInputLocked()
        }
        scheduleVisuals()
    }

    /** Hand touch ownership to (or take it back from) the overlay. UI thread only. */
    fun setActive(on: Boolean) {
        synchronized(lock) {
            if (active == on) return
            active = on
            clearAllInputLocked()
            buildAndInjectLocked()   // neutral frame so nothing can stay held across the switch
        }
        overlay.visibility = if (on) View.VISIBLE else View.GONE
        if (on) android.util.Log.i("GPM", "native input path ACTIVE (widgets=${widgets.size})")
        else android.util.Log.i("GPM", "native input path inactive")
        scheduleVisuals()
    }

    /** Gyro settings from JS (pushed on every change; cheap). */
    fun setGyroConfig(json: String) {
        try {
            val o = JSONObject(json)
            gyroOn = o.optBoolean("on", false)
            gyroMode3d = o.optString("mode") == "3d"
            gyroSensDeg = max(1.0, o.optDouble("sens", 45.0)).toFloat()
            gyroDzDeg = max(0.0, o.optDouble("dz", 0.0)).toFloat()
            gyroThrottle = o.optBoolean("throttle", false)
            gyroHaptic = o.optBoolean("haptic", false)
            hapticsEnabled = o.optBoolean("hapticsEnabled", true)
            // Automatic gyro idle detection (#2). The flag lives on the Activity
            // because the detector runs there (onSensorChanged, where the raw
            // up-vector is available); default ON to match the JS default.
            activity.gyroIdleDetectEnabled = o.optBoolean("idleDetect", true)
        } catch (e: Exception) { android.util.Log.e("NIN", "gyro config parse failed", e) }
    }

    /** Zero the tilt at the current hold — native twin of useGyro's calibrate(). */
    fun calibrate() {
        gyroZeroX = activity.fusedRollDeg
        gyroZeroY = activity.fusedPitchDeg
    }

    /**
     * ~200 Hz up-call from MainActivity.onSensorChanged (sensor thread). While the
     * native path owns input and gyro is on, every fused sample rebuilds + injects
     * the payload — gyro cadence is decoupled from both the WebView AND the display
     * refresh. The C++ memcmp suppresses sends when the quantized bytes are equal.
     */
    fun onGyroSample() {
        if (!active || !gyroOn) return
        synchronized(lock) { if (active) buildAndInjectLocked() }
    }

    // ═══════════════════════════ Touch handling ═══════════════════════════

    private fun handleTouch(ev: MotionEvent): Boolean {
        if (!active) return false
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val idx = ev.actionIndex
                val pid = ev.getPointerId(idx)
                val vx = ev.getX(idx); val vy = ev.getY(idx)
                val cssX = vx / dpr; val cssY = vy / dpr
                val primary = ev.actionMasked == MotionEvent.ACTION_DOWN
                // GPM: hardware/OS event time → this handler (the native replacement
                // for JS GPM's touch→dispatch segment).
                gpmSample((SystemClock.uptimeMillis() - ev.eventTime).toFloat())
                // HUD exclusion rects (css px): decline the primary gesture so the
                // WebView receives it natively.
                if (primary && inExclusion(cssX, cssY)) return false
                val hit = if (haveMatrix) hitTest(designX(cssX, cssY), designY(cssX, cssY)) else null
                if (hit == null) {
                    if (primary) return false        // whole gesture → WebView
                    // Merged pointer we can't decline: remember it and replay as a
                    // synthetic tap on release so HUD taps work mid-play.
                    val b = Binding(FWD_WIDGET)
                    b.fwdCssX = cssX; b.fwdCssY = cssY; b.fwdDownMs = SystemClock.uptimeMillis()
                    synchronized(lock) { bindings[pid] = b }
                    return true
                }
                synchronized(lock) {
                    val b = Binding(hit)
                    // useStick/DpadBase own ONE pointer (pid guard) — a second finger
                    // on the same stick/d-pad is ignored, never a second driver.
                    if ((hit.kind == K_STICK || hit.kind == K_DPAD) &&
                        bindings.values.any { it.widget === hit && !it.inert }) {
                        b.inert = true
                        bindings[pid] = b
                    } else {
                        bindings[pid] = b
                        pressLocked(b, designX(cssX, cssY), designY(cssX, cssY))
                        buildAndInjectLocked()
                    }
                }
                scheduleVisuals()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                var changed = false
                synchronized(lock) {
                    for (i in 0 until ev.pointerCount) {
                        val b = bindings[ev.getPointerId(i)] ?: continue
                        val cssX = ev.getX(i) / dpr; val cssY = ev.getY(i) / dpr
                        if (b.widget === FWD_WIDGET) {
                            if (hypot((cssX - b.fwdCssX).toDouble(), (cssY - b.fwdCssY).toDouble()) > 24) b.fwdMoved = true
                            continue
                        }
                        if (b.inert) continue
                        if (moveLocked(b, designX(cssX, cssY), designY(cssX, cssY))) changed = true
                    }
                    if (changed) buildAndInjectLocked()
                }
                if (changed) scheduleVisuals()
                return true
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP -> {
                val pid = ev.getPointerId(ev.actionIndex)
                var fwd: Binding? = null
                synchronized(lock) {
                    val b = bindings.remove(pid)
                    if (b != null) {
                        if (b.widget === FWD_WIDGET) fwd = b
                        else if (!b.inert) releaseLocked(b, cancelled = false)
                    }
                    if (ev.actionMasked == MotionEvent.ACTION_UP && bindings.isNotEmpty()) {
                        // Last finger up — nothing may stay held.
                        for (o in bindings.values) if (o.widget !== FWD_WIDGET && !o.inert) releaseLocked(o, cancelled = true)
                        bindings.clear()
                    }
                    buildAndInjectLocked()
                }
                fwd?.let { forwardTap(it) }
                scheduleVisuals()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                synchronized(lock) {
                    for (b in bindings.values) if (b.widget !== FWD_WIDGET && !b.inert) releaseLocked(b, cancelled = true)
                    bindings.clear()
                    buildAndInjectLocked()
                }
                scheduleVisuals()
                return true
            }
        }
        return true
    }

    private fun inExclusion(cssX: Float, cssY: Float): Boolean {
        val ex = exclusions
        var i = 0
        while (i < ex.size) {
            if (cssX >= ex[i] && cssX <= ex[i] + ex[i + 2] && cssY >= ex[i + 1] && cssY <= ex[i + 1] + ex[i + 3]) return true
            i += 4
        }
        return false
    }

    private fun designX(cssX: Float, cssY: Float) = ia * cssX + ic * cssY + ie
    private fun designY(cssX: Float, cssY: Float) = ib * cssX + id * cssY + iff

    /** Topmost widget containing the design-space point (render order = z order). */
    private fun hitTest(px: Float, py: Float): Widget? {
        val ws = widgets
        for (i in ws.indices.reversed()) {
            val w = ws[i]
            val inside = when (w.kind) {
                K_BTN -> if (w.rect) (px >= w.x - w.w / 2 && px <= w.x + w.w / 2 && py >= w.y - w.h / 2 && py <= w.y + w.h / 2)
                         else hypot((px - w.x).toDouble(), (py - w.y).toDouble()) <= w.r
                K_TRIG -> (px >= w.x - w.w / 2 && px <= w.x + w.w / 2 && py >= w.y - w.h / 2 && py <= w.y + w.h / 2)
                else -> hypot((px - w.x).toDouble(), (py - w.y).toDouble()) <= w.r   // dpad/stick/mode = circle
            }
            if (inside) return w
        }
        return null
    }

    // ── Press / move / release semantics — mirrors Widgets.tsx exactly ──

    private fun pressLocked(b: Binding, px: Float, py: Float) {
        val w = b.widget
        when (w.kind) {
            K_BTN -> {
                if (w.vis.isNotEmpty()) visHeldCustom.add(w.vis)
                haptic(w.hap)
            }
            K_DPAD -> {
                applyDpadLocked(b, px, py)   // fires the per-direction haptic itself
            }
            K_STICK -> {
                // useStick.onDown: centre = widget centre, pos stays neutral until
                // the first move (the down alone must not deflect the stick).
                b.stickLeft = if (w.which == 'H') stickMode == 'L' else w.which == 'L'
                if (w.vis.isNotEmpty()) visHeldCustom.add(w.vis)
                haptic(w.hap)
            }
            K_TRIG -> {
                val fill = if (w.digital) 1f else max(0.06f, trigFillAt(w, py))
                if (w.sideLeft) ltFill = fill else rtFill = fill
                if (w.vis.isNotEmpty()) { if (w.std) visHeldStd.add(w.vis) else visHeldCustom.add(w.vis) }
                haptic(w.hap)
            }
            K_MODE -> {
                stickMode = w.mode
                haptic(w.hap)
            }
        }
        rebuildMaskLocked()
    }

    private fun moveLocked(b: Binding, px: Float, py: Float): Boolean {
        val w = b.widget
        when (w.kind) {
            K_DPAD -> return applyDpadLocked(b, px, py)
            K_STICK -> {
                val dx = px - w.x; val dy = py - w.y
                val dist = hypot(dx.toDouble(), dy.toDouble()).toFloat()
                val r = min(dist, STICK_MAX_R)
                val nx = if (dist > 0f) dx / dist * r else 0f
                val ny = if (dist > 0f) dy / dist * r else 0f
                // Subtle rim tick, once per full deflection (useStick.onMove).
                val onRim = dist >= STICK_MAX_R - 0.5f
                if (onRim && !b.atRim) haptic("tick")
                b.atRim = onRim
                if (b.stickLeft) { lsX = nx; lsY = ny } else { rsX = nx; rsY = ny }
                return true
            }
            K_TRIG -> {
                if (w.digital) return false
                val fill = trigFillAt(w, py)
                if (w.sideLeft) { if (fill != ltFill) { ltFill = fill; return true } }
                else { if (fill != rtFill) { rtFill = fill; return true } }
                return false
            }
        }
        return false
    }

    private fun releaseLocked(b: Binding, cancelled: Boolean) {
        val w = b.widget
        when (w.kind) {
            K_BTN -> { if (w.vis.isNotEmpty()) visHeldCustom.remove(w.vis) }
            K_DPAD -> {
                b.dirUp = false; b.dirDown = false; b.dirLeft = false; b.dirRight = false
                visHeldCustom.remove(w.visUp); visHeldCustom.remove(w.visDown)
                visHeldCustom.remove(w.visLeft); visHeldCustom.remove(w.visRight)
            }
            K_STICK -> {
                if (b.stickLeft) { lsX = 0f; lsY = 0f } else { rsX = 0f; rsY = 0f }
                b.atRim = false
                if (w.vis.isNotEmpty()) visHeldCustom.remove(w.vis)
            }
            K_TRIG -> {
                if (w.sideLeft) ltFill = 0f else rtFill = 0f
                if (w.vis.isNotEmpty()) { if (w.std) visHeldStd.remove(w.vis) else visHeldCustom.remove(w.vis) }
            }
        }
        rebuildMaskLocked()
        // Two-stage press+release feel (Widgets.tsx releaseHaptic) — pointerup only,
        // never on cancel; mode selectors don't give a release tick in JS either.
        if (!cancelled && w.kind != K_MODE) haptic("buttonRelease")
    }

    /** Strict 4-way d-pad: single nearest cardinal, inner 28% deadzone (DpadBase.dirsAt). */
    private fun applyDpadLocked(b: Binding, px: Float, py: Float): Boolean {
        val w = b.widget
        val dx = px - w.x; val dy = py - w.y
        var u = false; var d = false; var l = false; var r = false
        if (hypot(dx.toDouble(), dy.toDouble()) >= w.r * 0.28f) {
            val a = Math.toDegrees(Math.atan2(dy.toDouble(), dx.toDouble()))
            when {
                a >= -45 && a < 45 -> r = true
                a >= 45 && a < 135 -> d = true
                a >= 135 || a < -135 -> l = true
                else -> u = true
            }
        }
        if (u == b.dirUp && d == b.dirDown && l == b.dirLeft && r == b.dirRight) return false
        // dn() edge per NEW direction — this is where the JS wrapper fires its haptic.
        if ((u && !b.dirUp) || (d && !b.dirDown) || (l && !b.dirLeft) || (r && !b.dirRight)) haptic(w.hap)
        b.dirUp = u; b.dirDown = d; b.dirLeft = l; b.dirRight = r
        if (u) visHeldCustom.add(w.visUp) else visHeldCustom.remove(w.visUp)
        if (d) visHeldCustom.add(w.visDown) else visHeldCustom.remove(w.visDown)
        if (l) visHeldCustom.add(w.visLeft) else visHeldCustom.remove(w.visLeft)
        if (r) visHeldCustom.add(w.visRight) else visHeldCustom.remove(w.visRight)
        rebuildMaskLocked()
        return true
    }

    private fun trigFillAt(w: Widget, py: Float): Float {
        val top = w.y - w.h / 2
        return ((top + w.h - py) / w.h).coerceIn(0f, 1f)
    }

    /** Mask = union over live bindings (same semantics as JS rebuilding from held sets). */
    private fun rebuildMaskLocked() {
        var m = 0
        for (b in bindings.values) {
            val w = b.widget
            when (w.kind) {
                K_BTN -> m = m or w.bits
                K_DPAD -> {
                    if (b.dirUp) m = m or w.bitsUp
                    if (b.dirDown) m = m or w.bitsDown
                    if (b.dirLeft) m = m or w.bitsLeft
                    if (b.dirRight) m = m or w.bitsRight
                }
            }
        }
        buttonsMask = m
    }

    private fun clearAllInputLocked() {
        bindings.clear()
        buttonsMask = 0
        ltFill = 0f; rtFill = 0f
        lsX = 0f; lsY = 0f; rsX = 0f; rsY = 0f
        visHeldCustom.clear(); visHeldStd.clear()
        gyroWasMax = false
    }

    // ═══════════════════════════ Payload build ═══════════════════════════

    private fun buildAndInjectLocked() {
        val p = payload
        // [0..7] timestamp + [16..19] authToken: the C++ TX thread stamps both on
        // every send — leave zeroed.
        p.fill(0)
        p[8] = (buttonsMask and 0xFF).toByte()
        p[9] = ((buttonsMask shr 8) and 0xFF).toByte()
        p[10] = trigByte(ltFill)
        p[11] = trigByte(rtFill)

        // Stick radial deadzone (App.tsx processStick), normalized -1..1.
        var lsXn: Float; var lsYn: Float; var rsXn: Float; var rsYn: Float
        run {
            val (x, y) = radialDeadzone(lsX, lsY); lsXn = x; lsYn = y
        }
        run {
            val (x, y) = radialDeadzone(rsX, rsY); rsXn = x; rsYn = y
        }

        // Gyro merged AFTER the deadzone — identical formula + signs to the JS
        // packet builder (racing lsX-gx / throttle lsY-gy; 3d rsX-gx / rsY+gy).
        // Suppressed while the phone is resting flat on a surface (activity's
        // authoritative flat+still detector — see MainActivity.gyroRestingFlat).
        // This is the correct fix for "phone set down walks the PC volume to
        // 100%": it never idles a HELD phone at any angle, only a resting one.
        if (gyroOn && !activity.gyroRestingFlat) {
            val nx = activity.fusedRollDeg - gyroZeroX
            val ny = activity.fusedPitchDeg - gyroZeroY
            val gateX = if (kotlin.math.abs(nx) < gyroDzDeg) 0f else nx
            val gateY = if (kotlin.math.abs(ny) < gyroDzDeg) 0f else ny
            val gx = (gateX / gyroSensDeg).coerceIn(-1f, 1f)
            val gy = (gateY / gyroSensDeg).coerceIn(-1f, 1f)
            if (!gyroMode3d) {
                lsXn = (lsXn - gx).coerceIn(-1f, 1f)
                if (gyroThrottle) lsYn = (lsYn - gy).coerceIn(-1f, 1f)
            } else {
                rsXn = (rsXn - gx).coerceIn(-1f, 1f)
                rsYn = (rsYn + gy).coerceIn(-1f, 1f)
            }
            // Full-lock tick, once per bottom-out (App.tsx lastGyroHitMax).
            if (gyroHaptic) {
                val isMax = (if (!gyroMode3d) kotlin.math.abs(gx) else max(kotlin.math.abs(gx), kotlin.math.abs(gy))) >= 0.99f
                if (isMax && !gyroWasMax) haptic("tick")
                gyroWasMax = isMax
            }
        }

        p[12] = axisByte(lsXn)
        p[13] = axisByte(lsYn)
        p[14] = axisByte(rsXn)
        p[15] = axisByte(rsYn)
        // Throwable, not Exception: a JNI linkage failure raises an Error, and it
        // must never take down the app from the sensor/touch threads.
        try { activity.injectPayload(p) } catch (e: Throwable) { /* engine not loaded */ }
    }

    private fun radialDeadzone(x: Float, y: Float): Pair<Float, Float> {
        val dist = hypot(x.toDouble(), y.toDouble()).toFloat()
        if (dist < STICK_DEADZONE || dist <= 0f) return 0f to 0f
        val factor = (dist - STICK_DEADZONE) / (STICK_MAX_R - STICK_DEADZONE)
        return (x / dist * factor) to (y / dist * factor)
    }

    private fun trigByte(fill: Float): Byte {
        val f = min(1f, fill / TRIG_THRESHOLD)
        return (f * 255f).roundToInt().coerceIn(0, 255).toByte()
    }

    private fun axisByte(norm: Float): Byte =
        (128f + norm * 127f).roundToInt().coerceIn(0, 255).toByte()

    // ═══════════════════════════ Haptics ═══════════════════════════

    /** Same tiers the JS side uses; gated by the user's haptics toggle. */
    private fun haptic(tier: String) {
        if (tier.isEmpty() || !hapticsEnabled) return
        activity.playHapticEvent(tier)
    }

    // ═══════════════════════════ Visual feedback → JS ═══════════════════════════

    private fun scheduleVisuals() {
        activity.runOnUiThread {
            if (!visScheduled) {
                visScheduled = true
                Choreographer.getInstance().postFrameCallback(visCallback)
            }
        }
    }

    private fun pushVisuals() {
        if (!active) return
        val o = JSONObject()
        synchronized(lock) {
            o.put("h", JSONArray(visHeldCustom.toList()))
            o.put("s", JSONArray(visHeldStd.toList()))
            o.put("lt", ltFill.toDouble())
            o.put("rt", rtFill.toDouble())
            o.put("lx", lsX.toDouble()); o.put("ly", lsY.toDouble())
            o.put("rx", rsX.toDouble()); o.put("ry", rsY.toDouble())
            o.put("m", stickMode.toString())
        }
        val json = o.toString()
        if (json == lastVisJson) return
        lastVisJson = json
        activity.evalJs("if(window.__nvis)window.__nvis($json);")
    }

    // ═══════════════════════════ Forward-tap synthesis ═══════════════════════════

    /**
     * A merged pointer that hit no widget (e.g. the GYRO toggle tapped while a
     * stick is held): replay it into the page as a synthetic pointerdown/up +
     * click at the same CSS coords. HUD controls use onPointerDown / onClick,
     * both of which this triggers.
     */
    private fun forwardTap(b: Binding) {
        if (b.fwdMoved) return
        if (SystemClock.uptimeMillis() - b.fwdDownMs > 600) return
        val x = b.fwdCssX; val y = b.fwdCssY
        activity.evalJs(
            "(function(){var e=document.elementFromPoint($x,$y);if(!e)return;" +
            "var o={bubbles:true,cancelable:true,clientX:$x,clientY:$y,pointerId:9999,pointerType:'touch'};" +
            "try{e.dispatchEvent(new PointerEvent('pointerdown',o));}catch(_){}" +
            "try{e.dispatchEvent(new PointerEvent('pointerup',o));}catch(_){}" +
            "try{if(e.click)e.click();}catch(_){}})();"
        )
    }

    // ═══════════════════════════ GPM metrics ═══════════════════════════

    private fun gpmSample(ms: Float) {
        if (ms < 0f || ms > 500f) return
        synchronized(gpmSamples) {
            if (gpmSamples.size < 4000) gpmSamples.add(ms)
            val now = SystemClock.uptimeMillis()
            if (gpmLastLog == 0L) gpmLastLog = now
            if (now - gpmLastLog > 5000 && gpmSamples.isNotEmpty()) {
                val s = gpmSamples.sorted()
                val avg = s.sum() / s.size
                val p = { q: Double -> s[min(s.size - 1, (s.size * q).toInt())] }
                android.util.Log.i("GPM", "native touch->handle: n=${s.size} avg=${"%.2f".format(avg)} " +
                        "p50=${"%.2f".format(p(0.5))} p95=${"%.2f".format(p(0.95))} max=${"%.2f".format(s.last())}ms")
                gpmSamples.clear()
                gpmLastLog = now
            }
        }
    }

    private val FWD_WIDGET = Widget(
        kind = -1, x = 0f, y = 0f, r = 0f, w = 0f, h = 0f, rect = false,
        bits = 0, bitsUp = 0, bitsDown = 0, bitsLeft = 0, bitsRight = 0,
        vis = "", visUp = "", visDown = "", visLeft = "", visRight = "",
        which = 'L', sideLeft = false, digital = false, std = false, mode = 'L', hap = ""
    )
}
