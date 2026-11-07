/**
 * Reading a device's pairing code over USB (Web Serial: Chrome or Edge on a
 * computer). Boards without a screen, like the ESP32-CAM, print
 * "pair-code:123456" on the serial port every few seconds while they wait to
 * be connected (firmware/door-wokwi/pair.cpp). Browser only.
 */

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike { requestPort(): Promise<SerialPortLike> }

export const usbSupported = () =>
  typeof navigator !== "undefined" && "serial" in navigator && typeof window !== "undefined" && window.isSecureContext;

/** The code in one line of serial output, or null. */
export const codeInLine = (line: string) => line.match(/pair-code:(\d{6})\b/)?.[1] ?? null;

/**
 * Ask for the port, listen until a code shows up (or `timeoutMs`), close the port.
 * Opening the port can restart the board; it prints the code again once it is
 * back on Wi-Fi, so the default wait covers a restart.
 */
export async function readPairCode(timeoutMs = 45_000): Promise<string> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  const port = await serial.requestPort();
  await port.open({ baudRate: 115200 });
  // let go of reset / boot on boards with auto-reset wiring (ESP32-CAM-MB, DevKits)
  await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
  const reader = port.readable!.getReader();
  const timer = setTimeout(() => { reader.cancel().catch(() => {}); }, timeoutMs);
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const code = codeInLine(l);
        if (code) return code;
      }
      if (buf.length > 4096) buf = buf.slice(-256);
    }
    throw new Error("No code heard. Check the board is on and not connected to a room yet.");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    await port.close().catch(() => {});
  }
}
