package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

// Holds the phone engine's maths equal to the page's. controller-ui/gen-golden.mjs ran thousands of touch
// moves and stick positions through the page's code and wrote what came out (golden_parity.txt); here the
// same inputs go through TouchpadMath and StickMath and must give the same numbers. If the page's rules
// change, regenerate the file (node gen-golden.mjs) and this test tells you what the phone must do too.
class ParityGoldenTest {
    private fun lines(): List<String> =
        javaClass.classLoader!!.getResourceAsStream("golden_parity.txt")!!.bufferedReader().readLines()

    @Test fun touchpadMatchesThePage() {
        var m: TouchpadMath? = null
        var steps = 0
        for ((i, line) in lines().withIndex()) {
            if (line.isBlank() || line.startsWith("#") || line.startsWith("S ")) continue
            val p = line.split(" ")
            if (p[0] == "P") { m = TouchpadMath(p[1], p[2], p[3].toDouble()); continue }
            if (p[0] == "E") { m = null; continue }
            val pad = m
            if (pad == null) { fail("line ${i + 1}: a step outside a sequence"); return }
            val t = p[1].toLong()
            when (p[0]) {
                "d" -> pad.down(p[2].toDouble(), p[3].toDouble(), t)
                "m" -> pad.move(p[2].toDouble(), p[3].toDouble(), t)
                "k" -> pad.tick(t)
                "u" -> pad.up(t)
                "r" -> pad.reset()
                else -> fail("line ${i + 1}: unknown step ${p[0]}")
            }
            assertEquals("line ${i + 1} x: $line", p[5].toDouble(), pad.x, 1e-6)
            assertEquals("line ${i + 1} y: $line", p[6].toDouble(), pad.y, 1e-6)
            assertEquals("line ${i + 1} active: $line", p[7] == "1", pad.active)
            steps++
        }
        assertTrue("the golden file was empty ($steps steps)", steps > 1000)
    }

    @Test fun stickResponseMatchesThePage() {
        var n = 0
        for ((i, line) in lines().withIndex()) {
            if (!line.startsWith("S ")) continue
            val p = line.split(" ")
            val (ox, oy) = StickMath.response(p[1].toFloat(), p[2].toFloat(), p[3].toFloat(), p[4].toFloat())
            assertEquals("line ${i + 1} x: $line", p[6].toDouble(), ox.toDouble(), 2e-5)
            assertEquals("line ${i + 1} y: $line", p[7].toDouble(), oy.toDouble(), 2e-5)
            n++
        }
        assertTrue("the golden file had no stick lines ($n)", n > 500)
    }

    @Test fun stickConstantsAreTheDocumentedOnes() {
        assertEquals(60f, StickMath.MAX_R, 0f)            // the page's STICK_MAX_R
        assertEquals(4.8f, StickMath.DEADZONE, 1e-6f)     // the page's STICK_DEADZONE (8% of 60)
    }
}
