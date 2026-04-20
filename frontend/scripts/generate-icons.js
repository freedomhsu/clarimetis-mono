const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join(__dirname, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

function makeSvg(size) {
  const rx = Math.round(size * 0.22);
  const pad = Math.round(size * 0.18);
  const inner = size - pad * 2;
  const br = Math.round(inner * 0.18); // bubble corner radius
  const tailW = Math.round(inner * 0.18);
  const tailH = Math.round(inner * 0.22);
  const bubbleH = Math.round(inner * 0.62);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#bg)"/>
  <rect x="${pad}" y="${pad}" width="${inner}" height="${bubbleH}" rx="${br}" fill="white" fill-opacity="0.92"/>
  <polygon points="${pad + Math.round(inner * 0.12)},${pad + bubbleH} ${pad + Math.round(inner * 0.12)},${pad + bubbleH + tailH} ${pad + Math.round(inner * 0.12) + tailW},${pad + bubbleH}" fill="white" fill-opacity="0.92"/>
</svg>`;
}

async function generate() {
  for (const size of sizes) {
    const svg = makeSvg(size);
    const outPath = path.join(outDir, `icon-${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    console.log(`icon-${size}.png`);
  }
}

generate().catch((err) => { console.error(err); process.exit(1); });
