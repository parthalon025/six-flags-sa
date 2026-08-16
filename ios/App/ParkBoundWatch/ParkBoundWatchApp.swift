import SwiftUI

@main
struct ParkBoundWatchApp: App {
  @StateObject private var session = WatchCompassSession.shared

  var body: some Scene {
    WindowGroup {
      NavigationStack {
        WatchCompassRootView()
          .environmentObject(session)
      }
    }
  }
}

struct WatchCompassRootView: View {
  @EnvironmentObject private var session: WatchCompassSession
  @State private var settings = WatchCompassSettings.load()

  var body: some View {
    TabView {
      WatchCompassView(
        settings: settings,
        heading: session.heading,
        marks: session.marks,
        nextTurn: session.nextTurn,
        raised: session.raised
      )
      .tabItem { Label("Compass", systemImage: "safari") }

      WatchCompassSettingsView(settings: $settings)
        .tabItem { Label("Settings", systemImage: "gearshape") }
    }
    .onAppear {
      session.activate()
      settings = WatchCompassSettings.load()
    }
    .onChange(of: settings) { _, next in
      next.save()
    }
  }
}
