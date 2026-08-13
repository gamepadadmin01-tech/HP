package com.gamepad.client

import android.app.Application

class GamepadApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // (Charge-bypass failsafe removed in v1.0 — was Shizuku-only. The default
        //  uncaught-exception handler is left untouched.)
    }
}
