import UIKit

// Classic AppDelegate lifecycle (no scene manifest): one window, one
// MainViewController. The controller UI is a WKWebView-hosted React app, so
// all navigation lives in JS — native owns only window + orientation.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = .black          // OLED blackout, same as Android decorView
        w.rootViewController = MainViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    // The JS layer drives orientation via AndroidBridge.setScreenOrientation:
    // dashboard = portrait, controller/editor = landscape. MainViewController
    // updates this mask and requests a geometry update.
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return MainViewController.orientationMask
    }
}
