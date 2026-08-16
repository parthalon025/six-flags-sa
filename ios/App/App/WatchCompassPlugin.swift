import Foundation
import Capacitor

/// Capacitor bridge: JS calls `WatchCompass.pushState({ heading, marks, nextTurn, settings, raised })`.
@objc(WatchCompassPlugin)
public class WatchCompassPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "WatchCompassPlugin"
  public let jsName = "WatchCompass"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "pushState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
  ]

  @objc func activate(_ call: CAPPluginCall) {
    WatchCompassPhoneSession.shared.activate()
    call.resolve()
  }

  @objc func pushState(_ call: CAPPluginCall) {
    var context: [String: Any] = [:]
    if call.hasOption("heading") {
      if let heading = call.getDouble("heading") {
        context["heading"] = heading
      } else {
        context["heading"] = NSNull()
      }
    }
    if let nextTurn = call.getString("nextTurn") {
      context["nextTurn"] = nextTurn
    }
    if let raised = call.getBool("raised") {
      context["raised"] = raised
    }
    if let marks = call.getArray("marks", JSObject.self) {
      context["marks"] = marks.map { dict -> [String: Any] in
        var out: [String: Any] = [:]
        for (k, v) in dict { out[k] = v }
        return out
      }
    }
    if let settings = call.getObject("settings") {
      var out: [String: Any] = [:]
      for (k, v) in settings { out[k] = v }
      context["settings"] = out
    }
    WatchCompassPhoneSession.shared.update(context: context)
    call.resolve()
  }
}
