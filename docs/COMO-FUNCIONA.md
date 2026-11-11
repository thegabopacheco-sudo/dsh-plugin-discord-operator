# Cómo funciona dsh-plugin-discord-operator

Operador de Discord para DeepSeek Harness: lee canales y mensajes de un servidor y
permite escribir (mensajes/ediciones/archivos) con confirmación, lista blanca y
auditoría. Nunca toca DMs y nunca expone el token.

---

## 1. API y autenticación

- Habla con **Discord REST API v10** por HTTPS (`fetch` nativo de Node), sin SDK.
- Token: `DISCORD_BOT_TOKEN` del entorno del host o `token` en
  `<DSH_HOME>\discord-operator\config.json`.
- La fila MCP del bundle pasa `DISCORD_BOT_TOKEN` desde el entorno del host (el
  cliente MCP limpia variables sensibles del entorno por defecto, por eso la fila
  la declara explícitamente).
- El token nunca se devuelve en una tool ni se escribe en logs; `status` solo
  informa la fuente (`env` o `config.json`).

---

## 2. Tools

| Tool | Flujo |
|---|---|
| `status` | Lee config (sin token), consulta `/users/@me` y `/users/@me/guilds`. |
| `channels` | Resuelve el guild (config o el primero), `GET /guilds/{id}/channels` y filtra tipos texto (0), anuncios (5) y foros (15). |
| `messages` | Resuelve el canal por id/nombre dentro del guild y `GET /channels/{id}/messages?limit=N`. |
| `send` | `confirm:true` → canal en lista blanca → `POST /channels/{id}/messages`. |
| `edit` | `confirm:true` → canal permitido → `PATCH /channels/{id}/messages/{id}`. |
| `upload` | `confirm:true` → canal permitido → ruta dentro de `allowedPaths` → `POST` multipart con `FormData`/`Blob`. |

---

## 3. Seguridad por capas

1. **Nunca DMs**: los canales se resuelven solo dentro del guild; los tipos DM (1)
   y grupo DM (3) nunca aparecen.
2. **Confirmación**: `send`/`edit`/`upload` exigen `confirm:true`; las
   instrucciones piden confirmación explícita del usuario.
3. **Lista blanca de canales**: si `allowedChannels` está vacío, no se escribe.
4. **Lista blanca de rutas**: `upload` solo acepta archivos dentro de
   `allowedPaths` (y ≤ 20 MB).
5. **Rate limit**: 10 escrituras por minuto.
6. **Auditoría**: cada escritura se registra con canal, longitud/tamaño y id de
   mensaje (sin contenido) en `cache\discord-operator\audit.jsonl`.
7. **Read-only**: `DSH_DISCORD_MODE=read-only` desactiva las escrituras.

---

## 4. Configuración

```json
{
  "token": "…",
  "guildId": "123",
  "allowedChannels": ["anuncios", "123"],
  "allowedPaths": ["C:\\Users\\tu-usuario\\.dsh\\cache"]
}
```

El `postinstall` crea el archivo vacío; el usuario completa token y listas.

---

## 5. Validación

- **Test end-to-end con mock local** de la API de Discord: `status`, `channels`
  (excluye DMs y voz), `messages`, send sin confirm (rechazado), send a canal no
  permitido (rechazado), send OK, edit OK, upload multipart OK y modo read-only.
- **Artefacto empaquetado**: `npm pack` → extraer → `postinstall` (deploy +
  config vacío) → servidor desplegado responde `status` y `channels` contra el
  mock.

Sin token real no se toca ningún servidor de Discord.

---

## 6. Solución de problemas

- Token inválido → 401; bot sin permisos → 403.
- Canal no encontrado → el mensaje lista los canales de texto disponibles.
- Instalación pidiendo permiso de scripts → aprobar; si el cartel se repite,
  `allowBuilds: true` en `pnpm-workspace.yaml`.
