// Park Bound Watch Compass — native companion sources.
// Preference key matches packages/shared/compass.js WATCH_SETTINGS_KEY.
// Live marks arrive via WatchConnectivity from WatchCompassPhoneSession.

import Foundation
import SwiftUI

enum CompassDensity: String, Codable, CaseIterable {
  case glance, split, detail
}

enum CompassAlwaysOn: String, Codable, CaseIterable {
  case calm, full, off
}

struct WatchCompassSettings: Codable, Equatable {
  var density: CompassDensity = .glance
  var alwaysOn: CompassAlwaysOn = .calm
  var showParty: Bool = true
  var showMeet: Bool = true
  var units: String = "imperial"
  var turnHaptics: Bool = true
  var raiseToNav: Bool = true

  static let storageKey = "parkbound-watch-compass-v1"

  static var shippingDefault: WatchCompassSettings { WatchCompassSettings() }

  static func load() -> WatchCompassSettings {
    guard let data = UserDefaults.standard.data(forKey: storageKey),
          let decoded = try? JSONDecoder().decode(WatchCompassSettings.self, from: data)
    else { return .shippingDefault }
    return decoded
  }

  func save() {
    if let data = try? JSONEncoder().encode(self) {
      UserDefaults.standard.set(data, forKey: Self.storageKey)
    }
  }
}

struct CompassMark: Identifiable {
  enum Kind: String { case member, meet, primary, north }
  var id: String
  var kind: Kind
  var bearing: Double
  var distanceM: Double?
  var label: String
  var showDistance: Bool
}

struct WatchCompassView: View {
  var settings: WatchCompassSettings
  var heading: Double?
  var marks: [CompassMark]
  var nextTurn: String?
  var raised: Bool = true

  var body: some View {
    Group {
      if !raised {
        alwaysOnBody
      } else if heading == nil {
        Text("Need facing")
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        raisedBody
      }
    }
  }

  @ViewBuilder
  private var alwaysOnBody: some View {
    switch settings.alwaysOn {
    case .off:
      Text("Raise to wake").font(.caption2).foregroundStyle(.secondary)
    case .calm:
      VStack(spacing: 4) {
        if let nextTurn { Text(nextTurn).font(.headline).foregroundStyle(.tint) }
        if let primary = marks.first(where: { $0.kind == .primary }),
           let d = primary.distanceM {
          Text(Self.formatDistance(d, units: settings.units))
            .font(.title2.bold())
        }
      }
    case .full:
      raisedBody
    }
  }

  private var raisedBody: some View {
    ZStack {
      Circle().strokeBorder(.secondary.opacity(0.35), lineWidth: 1.5)
      // Facing tick at top
      Capsule()
        .fill(Color.accentColor)
        .frame(width: 3, height: 12)
        .offset(y: -54)
      ForEach(visibleMarks) { mark in
        markView(mark)
          .offset(markOffset(mark.bearing))
      }
      VStack(spacing: 2) {
        if let primary = marks.first(where: { $0.kind == .primary }),
           let d = primary.distanceM, primary.showDistance {
          Text(Self.formatDistance(d, units: settings.units))
            .font(.caption.bold())
        }
        if let nextTurn, settings.density != .detail {
          Text(nextTurn).font(.caption2).foregroundStyle(.tint).lineLimit(1)
        }
      }
    }
    .frame(width: 120, height: 120)
  }

  private var visibleMarks: [CompassMark] {
    var list = marks.filter { mark in
      if mark.kind == .member && !settings.showParty { return false }
      if mark.kind == .meet && !settings.showMeet { return false }
      return true
    }
    let limit = settings.density == .glance ? 4 : settings.density == .split ? 6 : 12
    if list.count > limit { list = Array(list.prefix(limit)) }
    return list
  }

  private func markOffset(_ bearing: Double) -> CGSize {
    guard let heading else { return .zero }
    var rel = bearing - heading
    while rel > 180 { rel -= 360 }
    while rel < -180 { rel += 360 }
    let rad = (rel - 90) * .pi / 180
    let r: CGFloat = 48
    return CGSize(width: cos(rad) * r, height: sin(rad) * r)
  }

  @ViewBuilder
  private func markView(_ mark: CompassMark) -> some View {
    switch mark.kind {
    case .north:
      Text("N").font(.caption2.bold()).foregroundStyle(.secondary)
    case .meet:
      Image(systemName: "triangle.fill").foregroundStyle(.red).font(.caption2)
    case .primary:
      Circle().fill(Color.accentColor).frame(width: 12, height: 12)
    case .member:
      Circle().fill(Color.secondary).frame(width: 8, height: 8)
    }
  }

  static func formatDistance(_ m: Double, units: String) -> String {
    if units == "metric" {
      if m < 1000 { return "\(Int(m.rounded())) m" }
      return String(format: "%.1f km", m / 1000)
    }
    let ft = m * 3.28084
    if ft < 1000 { return "\(Int((ft / 5).rounded() * 5)) ft" }
    return String(format: "%.2f mi", ft / 5280)
  }
}

struct WatchCompassSettingsView: View {
  @Binding var settings: WatchCompassSettings

  var body: some View {
    Form {
      Picker("Density", selection: $settings.density) {
        Text("Glance").tag(CompassDensity.glance)
        Text("Split").tag(CompassDensity.split)
        Text("Detail").tag(CompassDensity.detail)
      }
      Picker("Always On", selection: $settings.alwaysOn) {
        Text("Calm").tag(CompassAlwaysOn.calm)
        Text("Full").tag(CompassAlwaysOn.full)
        Text("Off").tag(CompassAlwaysOn.off)
      }
      Toggle("Show party", isOn: $settings.showParty)
      Toggle("Show Meet", isOn: $settings.showMeet)
      Picker("Units", selection: $settings.units) {
        Text("ft / mi").tag("imperial")
        Text("m / km").tag("metric")
      }
      Toggle("Haptics on turn", isOn: $settings.turnHaptics)
      Toggle("Raise to show nav", isOn: $settings.raiseToNav)
    }
    .navigationTitle("Compass")
  }
}
