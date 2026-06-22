// Turns the generated landscape art into square, multi-resolution app icons:
//   - build/icon.ico  (Windows)
//   - build/icon.icns (macOS)
//   - build/icon.png   (512px master, used as a fallback)
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { Icns, IcnsImage } from "@fiahfy/icns";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets", "airshow-icon.png");
const buildDir = join(root, "build");
await mkdir(buildDir, { recursive: true });

// 1) Center-crop to a square, then trim the flat black border so the rounded
//    icon fills the frame.
const meta = await sharp(src).metadata();
const side = Math.min(meta.width, meta.height);
const left = Math.round((meta.width - side) / 2);
const top = Math.round((meta.height - side) / 2);

const cropped = await sharp(src)
  .extract({ left, top, width: side, height: side })
  .png()
  .toBuffer();

const trimmed = await sharp(cropped).trim({ threshold: 12 }).png().toBuffer();

const squarePng = await sharp(trimmed)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await writeFile(join(buildDir, "icon.png"), squarePng);

// 2) Emit the standard icon sizes and bundle them into a single .ico.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(
  sizes.map((s) =>
    sharp(squarePng).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
  ),
);

const ico = await pngToIco(pngs);
await writeFile(join(buildDir, "icon.ico"), ico);
console.log(`build/icon.ico written (${(ico.length / 1024).toFixed(1)} KB)`);

// 3) macOS .icns — one PNG per supported OSType (osType -> required pixel size).
const icnsTypes = [
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic13", 256],
  ["ic08", 256],
  ["ic14", 512],
  ["ic09", 512],
  ["ic10", 1024],
];
const icns = new Icns();
for (const [osType, size] of icnsTypes) {
  const buf = await sharp(squarePng)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  icns.append(IcnsImage.fromPNG(buf, osType));
}
await writeFile(join(buildDir, "icon.icns"), icns.data);
console.log(`build/icon.icns written (${(icns.data.length / 1024).toFixed(1)} KB)`);
