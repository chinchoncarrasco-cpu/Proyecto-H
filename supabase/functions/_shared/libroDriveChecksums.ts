// RFC 1321 MD5, used only to compare Drive's legacy content checksum, never for auth.
// SHA-256 remains the local source fingerprint. No Node-specific runtime dependency.
const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const constants = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));
export function md5Hex(bytes: Uint8Array): string {
  const padded = new Uint8Array(Math.ceil((bytes.byteLength + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bytes.byteLength * 8 >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.byteLength / 0x20000000), true);
  const state = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) :
        round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : 7 * i % 16;
      const sum = a + f + constants[i] + view.getUint32(offset + word * 4, true) | 0;
      const shift = shifts[round * 4 + i % 4];
      const next = b + ((sum << shift) | (sum >>> (32 - shift))) | 0;
      a = d; d = c; c = b; b = next;
    }
    state[0] = state[0] + a | 0; state[1] = state[1] + b | 0;
    state[2] = state[2] + c | 0; state[3] = state[3] + d | 0;
  }
  const digest = new DataView(new ArrayBuffer(16));
  state.forEach((value, i) => digest.setInt32(i * 4, value, true));
  return Array.from(new Uint8Array(digest.buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}
