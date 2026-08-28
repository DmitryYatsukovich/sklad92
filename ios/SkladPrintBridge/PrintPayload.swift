import Foundation

struct PrintPayload: Codable, Equatable {
    let v: Int?
    let type: String?
    let createdAt: String?
    let name: String
    let code: String
    let qrText: String
}

enum PrintPayloadParser {
    static func parse(from url: URL) throws -> PrintPayload {
        guard url.scheme?.lowercased() == "sklad92print" else {
            throw BridgeError.unsupportedLink
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw BridgeError.invalidLink
        }
        guard let encoded = components.queryItems?.first(where: { $0.name == "payload" })?.value, !encoded.isEmpty else {
            throw BridgeError.missingPayload
        }
        guard let data = decodeBase64Url(encoded) else {
            throw BridgeError.invalidPayloadFormat
        }
        do {
            return try JSONDecoder().decode(PrintPayload.self, from: data)
        } catch {
            throw BridgeError.invalidPayloadFormat
        }
    }

    private static func decodeBase64Url(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let pad = base64.count % 4
        if pad != 0 {
            base64 += String(repeating: "=", count: 4 - pad)
        }
        return Data(base64Encoded: base64)
    }
}

enum BridgeError: LocalizedError {
    case unsupportedLink
    case invalidLink
    case missingPayload
    case invalidPayloadFormat
    case invalidQrText
    case bluetoothUnavailable
    case printerNotConnected
    case printerWriteCharacteristicMissing

    var errorDescription: String? {
        switch self {
        case .unsupportedLink:
            return "Unsupported deep link scheme."
        case .invalidLink:
            return "Invalid deep link."
        case .missingPayload:
            return "Missing print payload."
        case .invalidPayloadFormat:
            return "Failed to decode print payload."
        case .invalidQrText:
            return "QR value is empty."
        case .bluetoothUnavailable:
            return "Bluetooth is unavailable."
        case .printerNotConnected:
            return "Printer is not connected."
        case .printerWriteCharacteristicMissing:
            return "Printer write channel was not found."
        }
    }
}
