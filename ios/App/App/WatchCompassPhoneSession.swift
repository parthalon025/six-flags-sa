import Foundation
import WatchConnectivity

/// iPhone-side WatchConnectivity session for the facing Compass (ADR-0011).
/// Push application context from the web layer via `WatchCompassPlugin` or
/// `WatchCompassPhoneSession.shared.update(...)`.
@objc final class WatchCompassPhoneSession: NSObject {
  @objc static let shared = WatchCompassPhoneSession()

  private var activated = false

  @objc func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    if session.delegate == nil {
      session.delegate = self
    }
    if session.activationState == .notActivated {
      session.activate()
    }
    activated = true
  }

  /// Mirrors `packages/shared/compass.js` payload shape.
  @objc func update(context: [String: Any]) {
    activate()
    guard WCSession.default.activationState == .activated else { return }
    guard WCSession.default.isWatchAppInstalled else { return }
    do {
      try WCSession.default.updateApplicationContext(context)
    } catch {
      NSLog("WatchCompassPhoneSession: %@", error.localizedDescription)
    }
  }
}

extension WatchCompassPhoneSession: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if let error {
      NSLog("WatchCompassPhoneSession activate: %@", error.localizedDescription)
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}
