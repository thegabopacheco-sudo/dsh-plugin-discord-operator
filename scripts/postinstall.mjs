// dsh-plugin-discord-operator — postinstall.
//
// Copia el servidor bundleado a <DSH_HOME>/plugins/discord-operator y crea el
// directorio de configuración (sin token: el token lo pone el usuario).
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function log(message) {
  process.stdout.write(`[dsh-plugin-discord-operator] ${message}\n`);
}

function findDshHome() {
  const fromEnv = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  if (fromEnv) return fromEnv;
  let current = packageDir;
  for (let depth = 0; depth < 14; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.basename(current).toLowerCase() === 'profiles') return path.dirname(current);
    current = parent;
  }
  const initCwd = process.env.INIT_CWD;
  if (initCwd && existsSync(path.join(initCwd, 'cordis.patch.yml'))) return path.dirname(initCwd);
  const fallback = path.join(homedir(), '.dsh');
  return existsSync(path.join(fallback, 'profiles')) ? fallback : null;
}

if (process.env.DSH_DISCORD_SKIP_POSTINSTALL === '1') {
  log('postinstall omitido (DSH_DISCORD_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const dshHome = findDshHome();
if (!dshHome) {
  log('no se encontró DSH_HOME; no se desplegó nada. Ejecuta install.ps1 manualmente.');
  process.exit(0);
}

const targetDir = path.join(dshHome, 'plugins', 'discord-operator');
const configDir = path.join(dshHome, 'discord-operator');
const configFile = path.join(configDir, 'config.json');
try {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const files = [
    [path.join(packageDir, 'dist', 'server.mjs'), path.join(targetDir, 'server.mjs')],
    [path.join(packageDir, 'package.json'), path.join(targetDir, 'package.json')],
  ];
  let copied = 0;
  for (const [from, to] of files) {
    if (!existsSync(from)) {
      log(`aviso: falta ${path.relative(packageDir, from)} (se omite)`);
      continue;
    }
    copyFileSync(from, to);
    copied++;
  }
  log(`desplegados ${copied}/${files.length} archivos en ${targetDir}`);

  mkdirSync(configDir, { recursive: true });
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify({
      token: '',
      guildId: '',
      allowedChannels: [],
      allowedPaths: [],
      note: 'Completa token y allowedChannels para habilitar escrituras. No commitees este archivo.'
    }, null, 2) + '\n', 'utf8');
    log(`config creada en ${configFile} (completa el token y la lista blanca).`);
  } else {
    log(`config existente: ${configFile}`);
  }
  log('listo. Reinicia DSH si las tools mcp__discord__* no aparecen.');
} catch (error) {
  log(`falló el despliegue: ${error.message}`);
  process.exit(0);
}
