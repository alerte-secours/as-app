import ExpoModulesCore
import FirebaseCore
import UIKit

@objc(AppDelegate)
class AppDelegate: ExpoAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Log to verify the new ExpoAppDelegate-based path runs on iOS.
    NSLog("[AppDelegate] didFinishLaunchingWithOptions (ExpoAppDelegate)")

    // Configure Firebase (react-native-firebase)
    FirebaseApp.configure()

    // Transistorsoft background fetch bootstrap.
    TSBackgroundFetch.sharedInstance().didFinishLaunching()
    NSLog("[AppDelegate] TSBackgroundFetch didFinishLaunching")

    // Configure React Native root module.
    moduleName = "main"
    initialProps = [:]

    let result = super.application(application, didFinishLaunchingWithOptions: launchOptions)
    NSLog("[AppDelegate] super.application(...) -> %@", result ? "true" : "false")
    return result
  }
}
