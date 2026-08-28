# Sklad Print Bridge (iOS)

Companion iOS app for direct Bluetooth printing from iPhone.

This bridge receives a deep link from the web app and sends the QR label to a BLE printer (M60-class label printers).

## Deep link format

The web app opens:

`sklad92print://print?payload=<base64url-json>`

Payload example:

```json
{
  "v": 1,
  "type": "tool_qr",
  "createdAt": "2026-08-28T04:00:00.000Z",
  "name": "Перфоратор",
  "code": "T-000231",
  "qrText": "T-000231"
}
```

## How to create the iOS app in Xcode

1. Create a new app in Xcode:
   - iOS App
   - SwiftUI
   - App name: `SkladPrintBridge`
2. Copy all `.swift` files from this folder into your Xcode target.
3. In target settings, add **URL Type**:
   - URL Schemes: `sklad92print`
4. Add Bluetooth usage text to `Info.plist`:
   - `NSBluetoothAlwaysUsageDescription` = `Need Bluetooth to print QR labels`
   - `NSBluetoothPeripheralUsageDescription` = `Need Bluetooth to connect to printer`
5. Build and install app on iPhone.

## User flow

1. In web app open tool QR preview.
2. Tap **"Печать на iPhone"**.
3. iOS bridge opens, receives payload, and shows printer UI.
4. Select/connect printer and tap **Print QR**.

## Notes

- iOS Safari does not support Web Bluetooth in browser pages; this bridge app bypasses that limitation.
- BLE printer protocols vary by vendor; current encoder uses ESC/POS raster data and common BLE write characteristics.
