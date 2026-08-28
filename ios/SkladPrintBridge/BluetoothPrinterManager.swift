import Foundation
import CoreBluetooth

struct DiscoveredPrinter: Identifiable, Hashable {
    let id: UUID
    let name: String
    let rssi: Int
}

@MainActor
final class BluetoothPrinterManager: NSObject, ObservableObject {
    @Published var statusText: String = "Ready"
    @Published var discovered: [DiscoveredPrinter] = []
    @Published var isScanning: Bool = false
    @Published var isConnected: Bool = false
    @Published var isPrinting: Bool = false
    @Published var currentPayload: PrintPayload?

    private let preferredCharacteristicUUIDs: Set<String> = [
        "0000ffe1-0000-1000-8000-00805f9b34fb",
        "0000ff02-0000-1000-8000-00805f9b34fb",
        "0000ffb2-0000-1000-8000-00805f9b34fb",
        "0000fff2-0000-1000-8000-00805f9b34fb",
        "0000ae01-0000-1000-8000-00805f9b34fb",
        "0000af01-0000-1000-8000-00805f9b34fb",
        "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
        "49535343-1e4d-4bd9-ba61-23c647249616"
    ]

    private let writeChunkSize = 180
    private lazy var central: CBCentralManager = CBCentralManager(delegate: self, queue: nil)

    private var peripheralById: [UUID: CBPeripheral] = [:]
    private var connectedPeripheral: CBPeripheral?
    private var writeCharacteristic: CBCharacteristic?

    private var pendingPrintData: Data?
    private var writeChunks: [Data] = []
    private var writeIndex: Int = 0

    override init() {
        super.init()
        _ = central
    }

    func handleDeepLink(_ url: URL) {
        do {
            let payload = try PrintPayloadParser.parse(from: url)
            currentPayload = payload
            statusText = "Payload received for \(payload.code)"
        } catch {
            statusText = error.localizedDescription
        }
    }

    func startScan() {
        guard central.state == .poweredOn else {
            statusText = BridgeError.bluetoothUnavailable.localizedDescription
            return
        }
        discovered.removeAll()
        peripheralById.removeAll()
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        isScanning = true
        statusText = "Scanning printers..."
    }

    func stopScan() {
        central.stopScan()
        isScanning = false
    }

    func connect(printerId: UUID) {
        guard let peripheral = peripheralById[printerId] else { return }
        stopScan()
        statusText = "Connecting to \(peripheral.name ?? "printer")..."
        central.connect(peripheral, options: nil)
    }

    func disconnect() {
        guard let peripheral = connectedPeripheral else { return }
        central.cancelPeripheralConnection(peripheral)
    }

    func printCurrentPayload() {
        guard let payload = currentPayload else {
            statusText = "No print payload."
            return
        }
        do {
            let data = try EscPosQrEncoder.buildPrintData(payload: payload)
            pendingPrintData = data
            if isConnected, let _ = writeCharacteristic {
                sendPendingDataIfPossible()
            } else {
                statusText = "Select and connect printer first."
                if !isScanning { startScan() }
            }
        } catch {
            statusText = error.localizedDescription
        }
    }

    private func sendPendingDataIfPossible() {
        if isPrinting { return }
        guard let data = pendingPrintData else { return }
        guard let characteristic = writeCharacteristic else {
            statusText = BridgeError.printerWriteCharacteristicMissing.localizedDescription
            return
        }
        guard let peripheral = connectedPeripheral else {
            statusText = BridgeError.printerNotConnected.localizedDescription
            return
        }

        isPrinting = true
        statusText = "Sending to printer..."
        writeChunks = stride(from: 0, to: data.count, by: writeChunkSize).map { start in
            let end = min(start + writeChunkSize, data.count)
            return data.subdata(in: start..<end)
        }
        writeIndex = 0
        writeNextChunk(peripheral: peripheral, characteristic: characteristic)
    }

    private func writeNextChunk(peripheral: CBPeripheral, characteristic: CBCharacteristic) {
        guard writeIndex < writeChunks.count else {
            isPrinting = false
            pendingPrintData = nil
            statusText = "Print data sent."
            return
        }

        let chunk = writeChunks[writeIndex]
        let canWriteWithoutResponse = characteristic.properties.contains(.writeWithoutResponse)

        if canWriteWithoutResponse {
            peripheral.writeValue(chunk, for: characteristic, type: .withoutResponse)
            writeIndex += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { [weak self] in
                guard let self = self else { return }
                self.writeNextChunk(peripheral: peripheral, characteristic: characteristic)
            }
        } else {
            peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
            writeIndex += 1
        }
    }

    private func maybeUseCharacteristic(_ candidate: CBCharacteristic) {
        guard candidate.properties.contains(.write) || candidate.properties.contains(.writeWithoutResponse) else {
            return
        }
        if writeCharacteristic == nil {
            writeCharacteristic = candidate
            return
        }
        guard let current = writeCharacteristic else { return }
        let candidateIsPreferred = preferredCharacteristicUUIDs.contains(candidate.uuid.uuidString.lowercased())
        let currentIsPreferred = preferredCharacteristicUUIDs.contains(current.uuid.uuidString.lowercased())
        if candidateIsPreferred && !currentIsPreferred {
            writeCharacteristic = candidate
        }
    }

    private func shouldShowPeripheral(_ peripheral: CBPeripheral) -> Bool {
        let name = (peripheral.name ?? "").lowercased()
        if name.contains("label") || name.contains("printer") || name.contains("m60") || name.contains("ablemark") {
            return true
        }
        return !name.isEmpty
    }
}

extension BluetoothPrinterManager: CBCentralManagerDelegate {
    nonisolated func centralManagerDidUpdateState(_ central: CBCentralManager) {
        Task { @MainActor in
            switch central.state {
            case .poweredOn:
                statusText = "Bluetooth ready."
            case .unauthorized:
                statusText = "Bluetooth permission denied."
            case .poweredOff:
                statusText = "Bluetooth is turned off."
            default:
                statusText = "Bluetooth unavailable."
            }
        }
    }

    nonisolated func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String : Any],
        rssi RSSI: NSNumber
    ) {
        Task { @MainActor in
            guard shouldShowPeripheral(peripheral) else { return }
            peripheralById[peripheral.identifier] = peripheral
            let row = DiscoveredPrinter(
                id: peripheral.identifier,
                name: peripheral.name ?? "Unknown printer",
                rssi: RSSI.intValue
            )
            if let index = discovered.firstIndex(where: { $0.id == row.id }) {
                discovered[index] = row
            } else {
                discovered.append(row)
            }
            discovered.sort { $0.rssi > $1.rssi }
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        Task { @MainActor in
            connectedPeripheral = peripheral
            writeCharacteristic = nil
            isConnected = true
            statusText = "Connected: \(peripheral.name ?? "printer")"
            peripheral.delegate = self
            peripheral.discoverServices(nil)
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            isConnected = false
            statusText = "Connection failed: \(error?.localizedDescription ?? "unknown error")"
        }
    }

    nonisolated func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        Task { @MainActor in
            isConnected = false
            writeCharacteristic = nil
            connectedPeripheral = nil
            if isPrinting { isPrinting = false }
            if let error = error {
                statusText = "Disconnected: \(error.localizedDescription)"
            } else {
                statusText = "Disconnected."
            }
        }
    }
}

extension BluetoothPrinterManager: CBPeripheralDelegate {
    nonisolated func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        Task { @MainActor in
            if let error = error {
                statusText = "Service discovery failed: \(error.localizedDescription)"
                return
            }
            guard let services = peripheral.services, !services.isEmpty else {
                statusText = "No services found on printer."
                return
            }
            for service in services {
                peripheral.discoverCharacteristics(nil, for: service)
            }
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didDiscoverCharacteristicsFor service: CBService,
        error: Error?
    ) {
        Task { @MainActor in
            if let error = error {
                statusText = "Characteristic discovery failed: \(error.localizedDescription)"
                return
            }
            guard let characteristics = service.characteristics else { return }
            for characteristic in characteristics {
                maybeUseCharacteristic(characteristic)
            }
            if writeCharacteristic != nil {
                statusText = "Printer ready."
                sendPendingDataIfPossible()
            }
        }
    }

    nonisolated func peripheral(
        _ peripheral: CBPeripheral,
        didWriteValueFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        Task { @MainActor in
            if let error = error {
                isPrinting = false
                statusText = "Write failed: \(error.localizedDescription)"
                return
            }
            writeNextChunk(peripheral: peripheral, characteristic: characteristic)
        }
    }
}
