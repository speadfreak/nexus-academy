// Generate PWA PNG icons from the SVG logo.
// iOS Safari requires PNG apple-touch-icon (180x180) for "Add to Home Screen".
// Android Chrome requires 192x192 + 512x512 PNG for install prompt.
// The SVG alone works for modern Chrome/Edge but NOT for iOS — so we need PNGs.

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const SVG_PATH = path.join(ROOT, "public/logo.svg");
const OUT_DIR = path.join(ROOT, "public");

const SIZES = [192, 512, 180]; // 180 = apple-touch-icon

async function main() {
  const svg = fs.readFileSync(SVG_PATH);
  for (const size of SIZES) {
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp(svg, { density: 300 })
      .resize(size, size, { fit: "contain", background: { r: 11, g: 15, b: 23, alpha: 1 } })
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath} (${size}x${size})`);
  }
  // apple-touch-icon.png (180x180, no transparent bg)
  await sharp(svg, { density: 300 })
    .resize(180, 180, { fit: "contain", background: { r: 11, g: 15, b: 23, alpha: 1 } })
    .png()
    .toFile(path.join(OUT_DIR, "apple-touch-icon.png"));
  console.log("Generated apple-touch-icon.png (180x180)");
  // favicon-like 32x32
  await sharp(svg, { density: 300 })
    .resize(32, 32, { fit: "contain", background: { r: 11, g: 15, b: 23, alpha: 1 } })
    .png()
    .toFile(path.join(OUT_DIR, "favicon-32.png"));
  console.log("Generated favicon-32.png (32x32)");
}

main().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
