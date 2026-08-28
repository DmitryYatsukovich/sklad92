import SwiftUI

struct ContentView: View {
    @ObservedObject var printerManager: BluetoothPrinterManager

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                GroupBox("Status") {
                    Text(printerManager.statusText)
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                GroupBox("Current payload") {
                    if let payload = printerManager.currentPayload {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(payload.name).font(.headline)
                            Text("Code: \(payload.code)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("QR text: \(payload.qrText)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Text("Open this app using deep link from web app.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                HStack(spacing: 8) {
                    Button(printerManager.isScanning ? "Stop scan" : "Scan printers") {
                        if printerManager.isScanning {
                            printerManager.stopScan()
                        } else {
                            printerManager.startScan()
                        }
                    }
                    .buttonStyle(.bordered)

                    Button("Print QR") {
                        printerManager.printCurrentPayload()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(printerManager.currentPayload == nil || printerManager.isPrinting)
                }

                if !printerManager.discovered.isEmpty {
                    Text("Discovered printers")
                        .font(.subheadline)
                        .bold()
                    List(printerManager.discovered) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.name)
                                Text("RSSI \(row.rssi)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Connect") {
                                printerManager.connect(printerId: row.id)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .listStyle(.plain)
                } else {
                    Text("No printers discovered yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("Sklad Print Bridge")
        }
    }
}
