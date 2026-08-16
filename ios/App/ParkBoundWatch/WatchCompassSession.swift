import Foundation
import WatchConnectivity
import Combine

/// Receives Compass payload from the iPhone host via WatchConnectivity.
@MainActor
final class WatchCompassSession: NSObject, ObservableObject {
  static let shared = WatchCompassSession()

  @Published var heading: Double?
  @Published var marks: [CompassMark] = []
  @Published var nextTurn: String?
  @Published var raised: Bool = true
  @Published var lastError: String?

  private var activated = false

  func activate() {
    guard WCSession.isSupported() else {
      lastError = "WatchConnectivity unavailable"
      loadSampleIfEmpty()
      return
    }
    let session = WCSession.default
    if session.delegate == nil { session.delegate = self }
    if !activated {
      session.activate()
      activated = true
    }
    apply(applicationContext: session.receivedApplicationContext)
    if marks.isEmpty { loadSampleIfEmpty() }
  }

  private func loadSampleIfEmpty() {
    guard marks.isEmpty else { return }
    heading = 45
    marks = [
      CompassMark(id: "go", kind: .primary, bearing: 45, distanceM: 180, label: "Steel Vengeance", showDistance: true),
      CompassMark(id: "meet", kind: .meet, bearing: 300, distanceM: 90, label: "Meet", showDistance: false),
      CompassMark(id: "j", kind: .member, bearing: 120, distanceM: 40, label: "Jordan", showDistance: false),
      CompassMark(id: "n", kind: .north, bearing: 0, distanceM: nil, label: "N", showDistance: false),
    ]
    nextTurn = "Left 120 ft"
  }

  func apply(applicationContext: [String: Any]) {
    guard !applicationContext.isEmpty else { return }
    if let h = applicationContext["heading"] as? Double {
      heading = h
    } else if applicationContext["heading"] is NSNull {
      heading = nil
    }
    if let turn = applicationContext["nextTurn"] as? String {
      nextTurn = turn
    }
    if let raisedFlag = applicationContext["raised"] as? Bool {
      raised = raisedFlag
    }
    if let rawMarks = applicationContext["marks"] as? [[String: Any]] {
      marks = rawMarks.compactMap { CompassMark(dictionary: $0) }
    }
    if let settingsBlob = applicationContext["settings"] as? [String: Any],
       let data = try? JSONSerialization.data(withJSONObject: settingsBlob),
       let decoded = try? JSONDecoder().decode(WatchCompassSettings.self, from: data) {
      decoded.save()
    }
  }
}

extension WatchCompassSession: WCSessionDelegate {
  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    Task { @MainActor in
      if let error { lastError = error.localizedDescription }
      apply(applicationContext: session.receivedApplicationContext)
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in
      apply(applicationContext: applicationContext)
    }
  }

  #if os(iOS)
  nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
  nonisolated func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
  #endif
}

extension CompassMark {
  init?(dictionary: [String: Any]) {
    guard let id = dictionary["id"] as? String,
          let kindRaw = dictionary["kind"] as? String,
          let kind = Kind(rawValue: kindRaw),
          let bearing = dictionary["bearing"] as? Double
    else { return nil }
    self.id = id
    self.kind = kind
    self.bearing = bearing
    self.distanceM = dictionary["distanceM"] as? Double
    self.label = (dictionary["label"] as? String) ?? kindRaw
    self.showDistance = (dictionary["showDistance"] as? Bool) ?? (kind == .primary)
  }
}
