// Prueba end-to-end de dsh-plugin-discord-operator contra un mock local de la
// API de Discord (sin token real). Verifica tools, lectura, lista blanca,
// confirmación, envío, edición, subida de archivo y modo read-only.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'discord-operator'), { recursive: true });
const uploadFile = path.join(tmpDir, 'subir.txt');
writeFileSync(uploadFile, 'archivo de prueba', 'utf8');

const configFile = path.join(tmpDir, 'dsh-home', 'discord-operator', 'config.json');
writeFileSync(configFile, JSON.stringify({
  token: 'test-token',
  guildId: 'g1',
  allowedChannels: ['anuncios'],
  allowedPaths: [tmpDir],
}, null, 2), 'utf8');

const CHANNELS = [
  { id: 'c1', name: 'anuncios', type: 0, position: 1 },
  { id: 'c2', name: 'general', type: 0, position: 2 },
  { id: 'c3', name: 'dm-fake', type: 1, position: 3 },
  { id: 'c4', name: 'voz', type: 2, position: 4 },
];

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/v10/users/@me') return json(res, 200, { id: 'bot1', username: 'WendigoBot', discriminator: '0' });
    if (route === 'GET /api/v10/users/@me/guilds') return json(res, 200, [{ id: 'g1', name: 'WENDIGO' }]);
    if (route === 'GET /api/v10/guilds/g1/channels') return json(res, 200, CHANNELS);
    if (route === 'GET /api/v10/channels/c1/messages') {
      return json(res, 200, [{ id: 'm1', content: 'hola comunidad', author: { username: 'gabriel' }, timestamp: '2026-11-11T00:00:00Z', attachments: [] }]);
    }
    if (route === 'POST /api/v10/channels/c1/messages') {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        return json(res, 200, { id: 'm3', content: '', attachments: [{ id: 'a1', filename: 'subir.txt' }] });
      }
      const payload = JSON.parse(body.toString('utf8'));
      return json(res, 200, { id: 'm2', content: payload.content });
    }
    if (route === 'PATCH /api/v10/channels/c1/messages/m2') {
      const payload = JSON.parse(body.toString('utf8'));
      return json(res, 200, { id: 'm2', content: payload.content });
    }
    json(res, 404, { message: 'not found para el mock', route });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const mockPort = mock.address().port;
const apiBase = `http://127.0.0.1:${mockPort}/api/v10`;

function makeClient(extraEnv = {}) {
  const serverEntry = process.env.DISCORD_SERVER
    ? path.resolve(process.env.DISCORD_SERVER)
    : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      PATH: process.env.PATH,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME || process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      DSH_HOME: path.join(tmpDir, 'dsh-home'),
      DSH_DISCORD_API_BASE: apiBase,
      ...extraEnv,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  const client = new Client(
    { name: 'discord-operator-test', version: '1.0.0' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } },
  );
  return client.connect(transport).then(() => ({ client, transport }));
}

function textOf(result) {
  return (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

const { client, transport } = await makeClient();

const tools = await client.listTools();
console.log('tools:', tools.tools.map((tool) => tool.name).join(', '));

const status = await client.callTool({ name: 'status', arguments: {} });
console.log('--- status ---');
console.log(textOf(status));

const channels = await client.callTool({ name: 'channels', arguments: {} });
console.log('--- channels ---');
const channelsText = textOf(channels);
console.log(channelsText);
console.log('excluye DM:', !channelsText.includes('dm-fake'), '| excluye voz:', !channelsText.includes('voz'));

const messages = await client.callTool({ name: 'messages', arguments: { channel: 'anuncios', limit: 5 } });
console.log('--- messages ---');
console.log(textOf(messages));

const dmAttempt = await client.callTool({ name: 'messages', arguments: { channel: 'dm-fake' } });
console.log('DM bloqueado isError:', dmAttempt.isError === true, '|', textOf(dmAttempt).slice(0, 140));

const noConfirm = await client.callTool({ name: 'send', arguments: { channel: 'anuncios', content: 'sin confirmar' } });
console.log('send sin confirm isError:', noConfirm.isError === true, '|', textOf(noConfirm).slice(0, 120));

const notAllowed = await client.callTool({ name: 'send', arguments: { channel: 'general', content: 'no permitido', confirm: true } });
console.log('send a canal no permitido isError:', notAllowed.isError === true, '|', textOf(notAllowed).slice(0, 160));

const sent = await client.callTool({ name: 'send', arguments: { channel: 'anuncios', content: 'Mensaje de prueba', confirm: true } });
console.log('--- send ---');
console.log(textOf(sent));

const edited = await client.callTool({ name: 'edit', arguments: { channel: '#anuncios', messageId: 'm2', content: 'Mensaje editado', confirm: true } });
console.log('--- edit ---');
console.log(textOf(edited));

const uploaded = await client.callTool({ name: 'upload', arguments: { channel: 'anuncios', path: uploadFile, content: 'adjunto', confirm: true } });
console.log('--- upload ---');
console.log(textOf(uploaded));

await client.close();
try { await transport.close?.(); } catch { /* ya cerrado */ }

const { client: roClient, transport: roTransport } = await makeClient({ DSH_DISCORD_MODE: 'read-only' });
const roSend = await roClient.callTool({ name: 'send', arguments: { channel: 'anuncios', content: 'read-only', confirm: true } });
console.log('read-only send isError:', roSend.isError === true, '|', textOf(roSend).slice(0, 120));
await roClient.close();
try { await roTransport.close?.(); } catch { /* ya cerrado */ }

const auditFile = path.join(tmpDir, 'dsh-home', 'cache', 'discord-operator', 'audit.jsonl');
const auditExists = readFileSync(auditFile, 'utf8').trim().length > 0;
console.log('audit.jsonl con entradas:', auditExists);
console.log('OK');

mock.close();
