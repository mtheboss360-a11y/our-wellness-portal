import { deflateSync, crc32 } from 'node:zlib';
import qrcodegen from './vendor/qrcodegen';
import { esc } from './html';
// QR codes for partner referral links, drawn on the server: an SVG for the page, the download and the print card,
// and a PNG for anyone who needs a raster file. Error correction is "quartile" so a printed code still scans when a
// corner is scuffed or covered by a thumb. Four modules of quiet space around the symbol, as the standard asks.
const QUIET = 4;
function modules(text: string) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.QUARTILE);
  return { size: qr.size, dark: (x: number, y: number) => qr.getModule(x, y) };
}
export function qrSvg(text: string, label: string) {
  const { size, dark } = modules(text);
  const full = size + QUIET * 2;
  let path = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${full}" height="${full}" fill="#fff"/><path fill="#1C3A2C" d="${path}"/></svg>`;
}
export function qrPng(text: string, scale = 12) {
  const { size, dark } = modules(text);
  const px = (size + QUIET * 2) * scale;
  // 8-bit greyscale rows, each prefixed with filter type 0.
  const raw = Buffer.alloc((px + 1) * px, 255);
  for (let row = 0; row < px; row++) {
    raw[row * (px + 1)] = 0;
    const y = Math.floor(row / scale) - QUIET;
    for (let col = 0; col < px; col++) {
      const x = Math.floor(col / scale) - QUIET;
      if (x >= 0 && y >= 0 && x < size && y < size && dark(x, y)) raw[row * (px + 1) + 1 + col] = 0;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(px, 0); header.writeUInt32BE(px, 4);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0; // 8-bit greyscale, no interlace
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
