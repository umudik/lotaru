import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const serverDist = join(repoRoot, 'packages', 'server', 'dist');
const cliDistServer = join(repoRoot, 'packages', 'cli', 'dist-server');

function run(cmd) {
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

run('npm --workspace @lotaru/web run build');
run('npm --workspace @lotaru/server run build');

if (!existsSync(serverDist)) {
  console.error('[build-publish] server dist missing');
  process.exit(1);
}

if (existsSync(cliDistServer)) {
  rmSync(cliDistServer, { recursive: true, force: true });
}
mkdirSync(cliDistServer, { recursive: true });
cpSync(serverDist, cliDistServer, { recursive: true });
console.log('[build-publish] copied server/dist -> cli/dist-server');

run('node scripts/cp-public.mjs');
run('npm --workspace @umudik/lotaru run build');

console.log('[build-publish] done');
