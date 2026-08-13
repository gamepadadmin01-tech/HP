# Gamepad App

This bundle contains the complete source code for the Gamepad application.

## Directory Structure

* **App Interface Design**: The React frontend web app that serves as the controller interface and dashboard. Contains the UI logic, gamepad mapping logic, and visual assets.
* **android-client**: The Kotlin Android application wrapper. It loads the React frontend into a fullscreen WebView, handles the physical back button intercepts, and passes native sensor/gyroscope data to the web app.

## How to Build

1. **Frontend (React)**: 
   Navigate to `App Interface Design`, run `npm install`, then `npm run build`. 
   Copy the contents of the `dist` folder to `android-client/app/src/main/assets/dist/`.

2. **Android App**: 
   Open the `android-client` folder in Android Studio. Ensure you have the NDK and SDK configured properly, then build the APK using `Install Debug` or `Build APK`.
