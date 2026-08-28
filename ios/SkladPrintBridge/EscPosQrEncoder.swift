import Foundation
import CoreImage
import CoreGraphics

private struct MonoBitmap {
    let width: Int
    let height: Int
    let widthBytes: Int
    let bytes: Data
}

enum EscPosQrEncoder {
    static let canvasSize = 384
    static let qrSize = 320

    static func buildPrintData(payload: PrintPayload) throws -> Data {
        let qrText = payload.qrText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !qrText.isEmpty else {
            throw BridgeError.invalidQrText
        }
        let bitmap = try buildBitmap(qrText: qrText)
        return buildEscPosData(bitmap: bitmap)
    }

    private static func buildBitmap(qrText: String) throws -> MonoBitmap {
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
            throw BridgeError.invalidPayloadFormat
        }
        filter.setValue(Data(qrText.utf8), forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let qrImage = filter.outputImage else {
            throw BridgeError.invalidPayloadFormat
        }

        let scale = CGFloat(qrSize) / max(qrImage.extent.width, qrImage.extent.height)
        let transformed = qrImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let ciContext = CIContext(options: nil)
        guard let qrCgImage = ciContext.createCGImage(transformed, from: transformed.extent) else {
            throw BridgeError.invalidPayloadFormat
        }

        let width = canvasSize
        let height = canvasSize
        let bytesPerRow = width
        let colorSpace = CGColorSpaceCreateDeviceGray()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            throw BridgeError.invalidPayloadFormat
        }

        context.setFillColor(gray: 1.0, alpha: 1.0)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .none
        let drawX = CGFloat((width - qrSize) / 2)
        let drawY = CGFloat((height - qrSize) / 2)
        context.draw(qrCgImage, in: CGRect(x: drawX, y: drawY, width: qrSize, height: qrSize))

        guard let raw = context.data else {
            throw BridgeError.invalidPayloadFormat
        }
        let pointer = raw.bindMemory(to: UInt8.self, capacity: width * height)
        let widthBytes = Int(ceil(Double(width) / 8.0))
        var raster = Data(count: widthBytes * height)

        raster.withUnsafeMutableBytes { outBuffer in
            guard let outBytes = outBuffer.bindMemory(to: UInt8.self).baseAddress else { return }
            var outIndex = 0
            for y in 0..<height {
                for byteX in 0..<widthBytes {
                    var packed: UInt8 = 0
                    for bit in 0..<8 {
                        let x = byteX * 8 + bit
                        if x >= width { continue }
                        let luma = pointer[y * bytesPerRow + x]
                        if luma < 128 {
                            packed |= (0x80 >> bit)
                        }
                    }
                    outBytes[outIndex] = packed
                    outIndex += 1
                }
            }
        }

        return MonoBitmap(width: width, height: height, widthBytes: widthBytes, bytes: raster)
    }

    private static func buildEscPosData(bitmap: MonoBitmap) -> Data {
        let xL = UInt8(bitmap.widthBytes & 0xff)
        let xH = UInt8((bitmap.widthBytes >> 8) & 0xff)
        let yL = UInt8(bitmap.height & 0xff)
        let yH = UInt8((bitmap.height >> 8) & 0xff)

        var data = Data()
        data.append(contentsOf: [0x1B, 0x40]) // init
        data.append(contentsOf: [0x1B, 0x61, 0x01]) // center
        data.append(contentsOf: [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]) // raster image
        data.append(bitmap.bytes)
        data.append(contentsOf: [0x0A, 0x0A, 0x0A, 0x0A]) // feed
        return data
    }
}
