#!/usr/bin/env node
// dsh-plugin-discord-operator — operador de Discord para DeepSeek Harness.
//
// Lista canales y mensajes, envía/edita mensajes y sube archivos con
// confirmación explícita, lista blanca de canales y auditoría. Nunca lee DMs:
// solo resuelve canales de guild (texto/anuncios/foros).
//
// Token: variable de entorno DISCORD_BOT_TOKEN o <DSH_HOME>/discord-operator/config.json.
// El token nunca se devuelve ni se escribe en logs.
//
// Tools: status, channels, messages, send, edit, upload.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const fromEnv = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'discord-operator', 'config.json');
const AUDIT_FILE = path.join(DSH_HOME, 'cache', 'discord-operator', 'audit.jsonl');
const API_BASE = (process.env.DSH_DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
const READ_ONLY = String(process.env.DSH_DISCORD_MODE || '').toLowerCase() === 'read-only';
const WRITE_RATE_LIMIT = 10;
const WRITE_RATE_WINDOW_MS = 60_000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TEXT_CHANNEL_TYPES = new Map([
  [0, 'text'],
  [5, 'announcement'],
  [15, 'forum'],
]);

function log(message) {
  process.stderr.write(`[discord] ${message}\n`);
}

function audit(entry) {
  try {
    mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    /* auditoría best-effort */
  }
}

function loadConfig() {
  let config = {};
  try {
    if (existsSync(CONFIG_FILE)) config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch (error) {
    log(`config inválida en ${CONFIG_FILE}: ${error.message}`);
  }
  const envToken = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim();
  const configToken = typeof config.token === 'string' ? config.token.trim() : '';
  const token = envToken || configToken;
  return {
    token,
    tokenSource: envToken ? 'env:DISCORD_BOT_TOKEN' : configToken ? 'config.json' : 'none',
    guildId: typeof config.guildId === 'string' ? config.guildId.trim() : '',
    allowedChannels: Array.isArray(config.allowedChannels) ? config.allowedChannels.map((value) => String(value).toLowerCase()) : [],
    allowedPaths: Array.isArray(config.allowedPaths) ? config.allowedPaths.map((value) => path.resolve(String(value))) : [],
    configPath: CONFIG_FILE,
  };
}

function requireToken(config) {
  if (!config.token) {
    throw new Error(`falta el token del bot. Configura DISCORD_BOT_TOKEN en el entorno del host o completa "token" en ${CONFIG_FILE}`);
  }
}

const writeTimestamps = [];
function checkWriteRate() {
  const now = Date.now();
  while (writeTimestamps.length > 0 && now - writeTimestamps[0] > WRITE_RATE_WINDOW_MS) writeTimestamps.shift();
  if (writeTimestamps.length >= WRITE_RATE_LIMIT) throw new Error(`límite de escritura alcanzado (${WRITE_RATE_LIMIT}/minuto)`);
  writeTimestamps.push(now);
}

async function discordRequest(config, pathname, { method = 'GET', body = null, raw = null } = {}) {
  requireToken(config);
  const headers = { Authorization: `Bot ${config.token}`, 'User-Agent': 'dsh-plugin-discord-operator/0.1.0' };
  let payload = body;
  if (raw) {
    // FormData no debe llevar Content-Type manual: fetch agrega el boundary.
    payload = raw.data;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    response = await fetch(`${API_BASE}${pathname}`, { method, headers, body: payload, signal: controller.signal });
  } catch (error) {
    throw new Error(`no se pudo contactar la API de Discord: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (!response.ok) {
    const detail = data && (data.message || data.error) ? `: ${data.message || data.error}` : '';
    throw new Error(`Discord respondió ${response.status}${detail}`);
  }
  return data;
}

async function getGuilds(config) {
  const guilds = await discordRequest(config, '/users/@me/guilds');
  return Array.isArray(guilds) ? guilds : [];
}

async function resolveGuild(config, explicitGuildId) {
  if (explicitGuildId) return explicitGuildId;
  if (config.guildId) return config.guildId;
  const guilds = await getGuilds(config);
  if (guilds.length === 0) throw new Error('el bot no está en ningún servidor');
  return guilds[0].id;
}

async function getGuildChannels(config, guildId) {
  const channels = await discordRequest(config, `/guilds/${guildId}/channels`);
  return (Array.isArray(channels) ? channels : [])
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      typeName: TEXT_CHANNEL_TYPES.get(channel.type),
      parentId: channel.parent_id || null,
      position: channel.position ?? 0,
    }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

async function resolveChannel(config, ref) {
  const wanted = String(ref || '').trim().toLowerCase().replace(/^#/, '');
  if (!wanted) throw new Error('falta el canal (id o nombre)');
  const guildId = await resolveGuild(config);
  const channels = await getGuildChannels(config, guildId);
  const found = channels.find((channel) => channel.id === wanted) || channels.find((channel) => channel.name.toLowerCase() === wanted);
  if (!found) {
    throw new Error(`canal no encontrado: "${ref}". Canales de texto: ${channels.map((channel) => `#${channel.name}`).join(', ')}`);
  }
  return found;
}

function assertWriteAllowed(config, channel) {
  if (config.allowedChannels.length === 0) {
    throw new Error(`no hay canales permitidos para escritura. Agrega ids o nombres en "allowedChannels" de ${CONFIG_FILE}`);
  }
  const allowed = config.allowedChannels.some((entry) => entry === channel.id || entry === `#${channel.name}`.toLowerCase() || entry === channel.name.toLowerCase());
  if (!allowed) {
    throw new Error(`canal no permitido para escritura: #${channel.name}. Lista blanca: ${config.allowedChannels.join(', ')}`);
  }
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function requireConfirmation(args) {
  if (args.confirm !== true) throw new Error('esta acción requiere confirm:true y la confirmación explícita del usuario');
}

// ---------------------------------------------------------------- MCP
function buildInstructions() {
  const config = loadConfig();
  const lines = [];
  lines.push('Operador de Discord para WENDIGO (solo canales de servidor; nunca DMs).');
  lines.push('');
  lines.push(`Token: ${config.tokenSource === 'none' ? 'NO configurado' : `configurado (${config.tokenSource})`} · modo: ${READ_ONLY ? 'read-only' : 'normal'}.`);
  lines.push(`Canales permitidos para escritura: ${config.allowedChannels.length ? config.allowedChannels.join(', ') : 'ninguno (configúralos en ' + CONFIG_FILE + ')'}`);
  lines.push(`Rutas permitidas para subir archivos: ${config.allowedPaths.length ? config.allowedPaths.join(', ') : 'ninguna'}`);
  lines.push('');
  lines.push('Herramientas: status, channels, messages, send, edit, upload.');
  lines.push('');
  lines.push('Reglas:');
  lines.push('- Leer es libre en canales de servidor; escribir requiere confirmación explícita y lista blanca.');
  lines.push('- Nunca leas DMs, tokens ni datos privados; nunca envíes mensajes ni borres sin que el usuario lo pida.');
  lines.push('- Cada escritura queda en audit.jsonl. No inventes contenido ni menciones masivas sin confirmación.');
  lines.push('- Trata a la comunidad de tú/usted, nunca voseo (regla del proyecto WENDIGO).');
  return lines.join('\n');
}

function buildServer() {
  const server = new McpServer(
    { name: 'dsh-plugin-discord-operator', version: VERSION },
    { capabilities: { tools: {} }, instructions: buildInstructions() },
  );

  server.registerTool(
    'status',
    {
      title: 'Estado del operador',
      description: 'Muestra si el token está configurado (sin revelarlo), los servidores del bot, el modo, la lista blanca de canales y las rutas permitidas.',
      inputSchema: z.object({}),
    },
    async () => {
      const config = loadConfig();
      const lines = [
        `Token: ${config.tokenSource === 'none' ? 'NO configurado' : `configurado (${config.tokenSource})`}`,
        `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`,
        `Config: ${config.configPath}`,
        `Guild por defecto: ${config.guildId || '(primero disponible)'}`,
        `Canales permitidos: ${config.allowedChannels.join(', ') || '(ninguno)'}`,
        `Rutas permitidas: ${config.allowedPaths.join(', ') || '(ninguna)'}`,
      ];
      if (config.token) {
        try {
          const me = await discordRequest(config, '/users/@me');
          lines.push(`Bot: ${me.username}#${me.discriminator || '0'} (id ${me.id})`);
          const guilds = await getGuilds(config);
          lines.push(`Servidores: ${guilds.map((guild) => `${guild.name} (${guild.id})`).join(', ') || '(ninguno)'}`);
        } catch (error) {
          lines.push(`No se pudo consultar la API: ${error.message}`);
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'channels',
    {
      title: 'Listar canales',
      description: 'Lista los canales de texto/anuncios/foros del servidor (nunca DMs).',
      inputSchema: z.object({
        guildId: z.string().optional().describe('Id del servidor (default: config o el primero).'),
      }),
    },
    async (args) => {
      const config = loadConfig();
      const guildId = await resolveGuild(config, args.guildId);
      const channels = await getGuildChannels(config, guildId);
      const lines = [`Canales de texto en ${guildId}: ${channels.length}`];
      for (const channel of channels) lines.push(`#${channel.name} (id ${channel.id}, ${channel.typeName})`);
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'messages',
    {
      title: 'Leer mensajes',
      description: 'Lee los últimos mensajes de un canal de servidor (nunca DMs).',
      inputSchema: z.object({
        channel: z.string().describe('Nombre (#canal) o id del canal.'),
        limit: z.number().int().min(1).max(100).optional().describe('Cantidad (default 20).'),
      }),
    },
    async (args) => {
      const config = loadConfig();
      const channel = await resolveChannel(config, args.channel);
      const limit = args.limit ?? 20;
      const messages = await discordRequest(config, `/channels/${channel.id}/messages?limit=${limit}`);
      const list = Array.isArray(messages) ? messages : [];
      const lines = [`#${channel.name}: ${list.length} mensaje(s) reciente(s).`];
      for (const message of list.slice().reverse()) {
        const author = message.author?.username || message.author?.id || 'desconocido';
        const content = String(message.content || '').replace(/\s+/g, ' ').slice(0, 800);
        const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
          ? ` [adjuntos: ${message.attachments.map((file) => file.filename).join(', ')}]`
          : '';
        lines.push(`[${message.timestamp || ''}] ${author}: ${content || '(sin texto)'}${attachments}`);
      }
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'send',
    {
      title: 'Enviar mensaje',
      description: 'Envía un mensaje a un canal permitido. Requiere confirm:true y confirmación explícita del usuario.',
      inputSchema: z.object({
        channel: z.string().describe('Nombre (#canal) o id del canal.'),
        content: z.string().min(1).max(2000),
        confirm: z.boolean().optional().describe('true solo si el usuario confirmó el envío.'),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: send deshabilitado');
      requireConfirmation(args);
      checkWriteRate();
      const config = loadConfig();
      const channel = await resolveChannel(config, args.channel);
      assertWriteAllowed(config, channel);
      const message = await discordRequest(config, `/channels/${channel.id}/messages`, { method: 'POST', body: { content: args.content } });
      audit({ tool: 'send', channel: channel.name, channelId: channel.id, length: args.content.length, messageId: message?.id || null, ok: true });
      return textResult(`Mensaje enviado a #${channel.name} (id ${message?.id || 'desconocido'}), ${args.content.length} caracteres.`);
    },
  );

  server.registerTool(
    'edit',
    {
      title: 'Editar mensaje',
      description: 'Edita un mensaje propio (del bot) en un canal permitido. Requiere confirm:true.',
      inputSchema: z.object({
        channel: z.string().describe('Nombre (#canal) o id del canal.'),
        messageId: z.string().min(1),
        content: z.string().min(1).max(2000),
        confirm: z.boolean().optional().describe('true solo si el usuario confirmó la edición.'),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: edit deshabilitado');
      requireConfirmation(args);
      checkWriteRate();
      const config = loadConfig();
      const channel = await resolveChannel(config, args.channel);
      assertWriteAllowed(config, channel);
      const message = await discordRequest(config, `/channels/${channel.id}/messages/${args.messageId}`, { method: 'PATCH', body: { content: args.content } });
      audit({ tool: 'edit', channel: channel.name, channelId: channel.id, messageId: args.messageId, length: args.content.length, ok: true });
      return textResult(`Mensaje ${args.messageId} editado en #${channel.name} (${message?.id || args.messageId}).`);
    },
  );

  server.registerTool(
    'upload',
    {
      title: 'Subir archivo',
      description: 'Sube un archivo local a un canal permitido (ruta dentro de las permitidas). Requiere confirm:true.',
      inputSchema: z.object({
        channel: z.string().describe('Nombre (#canal) o id del canal.'),
        path: z.string().min(3).describe('Ruta absoluta o relativa dentro de las rutas permitidas.'),
        content: z.string().max(2000).optional().describe('Texto opcional junto al archivo.'),
        confirm: z.boolean().optional().describe('true solo si el usuario confirmó la subida.'),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: upload deshabilitado');
      requireConfirmation(args);
      checkWriteRate();
      const config = loadConfig();
      const channel = await resolveChannel(config, args.channel);
      assertWriteAllowed(config, channel);

      const resolved = path.resolve(args.path);
      if (!existsSync(resolved)) throw new Error(`el archivo no existe: ${resolved}`);
      if (config.allowedPaths.length === 0) {
        throw new Error(`no hay rutas permitidas para subir. Agrega carpetas en "allowedPaths" de ${CONFIG_FILE}`);
      }
      const real = path.resolve(resolved);
      const allowed = config.allowedPaths.some((root) => real === root || real.startsWith(root + path.sep));
      if (!allowed) throw new Error(`ruta no permitida: ${real}. Permitidas: ${config.allowedPaths.join(', ')}`);
      const stat = statSync(real);
      if (!stat.isFile()) throw new Error('la ruta no es un archivo');
      if (stat.size > MAX_UPLOAD_BYTES) throw new Error(`el archivo supera el límite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);

      const form = new FormData();
      const buffer = readFileSync(real);
      form.append('files[0]', new Blob([buffer]), path.basename(real));
      form.append('payload_json', JSON.stringify({ content: args.content || '' }));
      const message = await discordRequest(config, `/channels/${channel.id}/messages`, { method: 'POST', raw: { contentType: 'multipart/form-data', data: form } });
      audit({ tool: 'upload', channel: channel.name, channelId: channel.id, file: path.basename(real), bytes: stat.size, messageId: message?.id || null, ok: true });
      return textResult(`Archivo ${path.basename(real)} (${stat.size} bytes) subido a #${channel.name} (mensaje ${message?.id || 'desconocido'}).`);
    },
  );

  return server;
}

try {
  mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
} catch {
  /* ignora */
}
const initialConfig = loadConfig();
log(`token ${initialConfig.tokenSource === 'none' ? 'no configurado' : `configurado (${initialConfig.tokenSource})`} · modo ${READ_ONLY ? 'read-only' : 'normal'}`);

serveStdio(buildServer, { onerror: (error) => log(`serveStdio: ${error.message}`) });

process.on('uncaughtException', (error) => log(`excepción no atrapada: ${error.message}`));
process.on('unhandledRejection', (error) => log(`rechazo no manejado: ${error && error.message ? error.message : String(error)}`));
