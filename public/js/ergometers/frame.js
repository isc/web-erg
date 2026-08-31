/**
 * Reading the bytes of a GATT notification.
 *
 * Both adapters do the same three things to a DataView — pull a little-endian integer out of it,
 * and print it when it will not parse — and the PM5 adds a width the DataView API does not have:
 * 24-bit. Elapsed time, distance and split time are all three bytes on the proprietary service, so
 * it is not a detail that can be worked around at one call site.
 */

export const u8 = (view, offset) => view.getUint8(offset)
export const u16 = (view, offset) => view.getUint16(offset, true)
export const i16 = (view, offset) => view.getInt16(offset, true)

// Little-endian, like everything else the PM5 sends.
export const u24 = (view, offset) =>
  view.getUint8(offset) |
  (view.getUint8(offset + 1) << 8) |
  (view.getUint8(offset + 2) << 16)

// A packet that arrives and then fails to parse leaves exactly the same trace as a packet that
// never arrived: none. Announcing the raw bytes of the first one, before touching them, is what
// separates "the device is silent" from "we cannot read what it says".
export function describeBytes(value) {
  return Array.from(new Uint8Array(value.buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(' ')
}
