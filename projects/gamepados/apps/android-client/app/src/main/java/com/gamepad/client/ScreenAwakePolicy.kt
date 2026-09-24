package com.gamepad.client

/** UI-thread-owned state: browsing, backgrounding and quota expiry may sleep. */
internal class ScreenAwakePolicy {
    var resumed = false
    var controllerActive = false
    val keepAwake: Boolean get() = resumed && controllerActive
}
