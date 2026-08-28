import SwiftUI

@main
struct SkladPrintBridgeApp: App {
    @StateObject private var printerManager = BluetoothPrinterManager()

    var body: some Scene {
        WindowGroup {
            ContentView(printerManager: printerManager)
                .onOpenURL { url in
                    printerManager.handleDeepLink(url)
                }
        }
    }
}
