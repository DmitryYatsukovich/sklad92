import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  path.join(root, 'server/public/index.html'),
  path.join(root, 'client/dist/index.html'),
];
const strictMode = process.env.CLIENT_BUILD_STRICT === 'true';

function warnAndExit(message, error) {
  console.warn(message);
  if (error) {
    const details = error?.stderr?.toString?.() || error?.message || String(error);
    console.warn(details);
  }
  if (strictMode) {
    process.exit(1);
  }
  process.exit(0);
}

if (candidates.some((p) => fs.existsSync(p))) {
  console.log('Client build OK:', candidates.find((p) => fs.existsSync(p)));
  process.exit(0);
}

if (!fs.existsSync(path.join(root, 'client/package.json'))) {
  warnAndExit(
    'Client sources not found; starting API without frontend build. '
    + 'Set CLIENT_BUILD_STRICT=true to fail startup in this case.',
  );
}

console.log('Client build missing — building (node_modules from Build step)...');
try {
  execSync('npm run build --prefix client', { cwd: root, stdio: 'inherit' });
} catch (error) {
  warnAndExit(
    'Client build failed; starting API without frontend build. '
    + 'Set CLIENT_BUILD_STRICT=true to fail startup.',
    error,
  );
}

if (!candidates.some((p) => fs.existsSync(p))) {
  warnAndExit(
    'Client build did not produce index.html; starting API without frontend build. '
    + 'Set CLIENT_BUILD_STRICT=true to fail startup.',
  );
}
