import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'web/package-lock.json'), 'utf8'));
let output = `갱신: ${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST (UTC+09:00)\n\nFolio — Third-party notices\n\nInstalled production JavaScript dependency licenses and restored NuGet package licenses. Package authors retain their copyrights.\n`;
function appendLicense(directory, label, metadata = '') {
  const files = fs.readdirSync(directory).filter(name => /^(licen[cs]e|copying|copyright|third.?party.?notices)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  output += `\n\n---\n\n${label}\n${metadata}\n`;
  for (const name of files) output += `\n${name}\n\n${fs.readFileSync(path.join(directory, name), 'utf8')}\n`;
}
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative || entry.dev || entry.devOptional) continue;
  const directory = path.join(root, 'web', relative);
  if (!fs.existsSync(directory)) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  appendLicense(directory, `${pkg.name} ${pkg.version}`, `License: ${pkg.license ?? entry.license ?? 'See package source'}`);
}
const assets = JSON.parse(fs.readFileSync(path.join(root, 'src/Folio/obj/project.assets.json'), 'utf8'));
for (const [name, lib] of Object.entries(assets.libraries)) {
  for (const folder of Object.keys(assets.packageFolders)) {
    const directory = path.join(folder, lib.path ?? '');
    if (fs.existsSync(directory)) { appendLicense(directory, name); break; }
  }
}
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), output);
console.log('Third-party notices collected.');
