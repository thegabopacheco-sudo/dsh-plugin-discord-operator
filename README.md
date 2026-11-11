# dsh-plugin-discord-operator — operador de Discord para DeepSeek Harness

Plugin MCP local para operar un servidor de Discord sin salir de DSH: listar
canales, leer mensajes, enviar y editar mensajes y subir archivos con
**confirmación explícita**, **lista blanca de canales** y **auditoría**. Nunca lee
DMs y el token no se expone.

[English](README.en.md) · [Cómo funciona](docs/COMO-FUNCIONA.md) · MIT

## Herramientas (6)

| Tool | Qué hace |
|---|---|
| `mcp__discord__status` | Estado: token configurado (sin mostrarlo), bot, servidores, modo, listas blancas. |
| `mcp__discord__channels` | Lista canales de texto/anuncios/foros del servidor (nunca DMs). |
| `mcp__discord__messages` | Lee los últimos mensajes de un canal de servidor. |
| `mcp__discord__send` | Envía un mensaje (`confirm:true` + canal permitido). |
| `mcp__discord__edit` | Edita un mensaje del bot (`confirm:true` + canal permitido). |
| `mcp__discord__upload` | Sube un archivo local (`confirm:true` + canal y ruta permitidos). |

## Configuración del token

El token se toma, en este orden:

1. Variable de entorno del host `DISCORD_BOT_TOKEN` (la pasa la fila MCP).
2. Archivo local `<DSH_HOME>\discord-operator\config.json`:

```json
{
  "token": "TU_TOKEN_DE_BOT",
  "guildId": "123456789012345678",
  "allowedChannels": ["anuncios", "123456789012345678"],
  "allowedPaths": ["C:\\Users\\tu-usuario\\.dsh\\cache"]
}
```

- `allowedChannels`: ids o nombres (`#canal` o `canal`) donde se permite escribir.
  Si está vacío, las escrituras se rechazan.
- `allowedPaths`: carpetas desde las que se pueden subir archivos.
- El `postinstall` crea el archivo vacío para que solo completes el token.
- **Nunca commitees** el token.

## Instalación

Desde **DSH → Settings → Plugins** instala
`github:thegabopacheco-sudo/dsh-plugin-discord-operator` y permite el script de
instalación.

Por CLI:

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-discord-operator
```

El `postinstall` copia el runtime a `<DSH_HOME>\plugins\discord-operator` y crea
`<DSH_HOME>\discord-operator\config.json`.

Requisitos: Windows 10/11, Node ≥ 20 (lo aporta el harness) y un **bot de Discord**
con permisos de lectura/escritura en los canales configurados.

## Seguridad

- **Lectura por defecto**, escritura solo con `confirm:true` y pedido explícito.
- **Lista blanca de canales** para escritura; **lista blanca de rutas** para subir.
- **Nunca DMs**: solo se resuelven canales de servidor (texto/anuncios/foros).
- **Auditoría** en `<DSH_HOME>\cache\discord-operator\audit.jsonl` (sin contenido).
- **Rate limit** de 10 escrituras por minuto.
- **Read-only**: `DSH_DISCORD_MODE=read-only` desactiva send/edit/upload.
- El token no se devuelve en ninguna tool ni se escribe en logs.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DISCORD_BOT_TOKEN` | Token del bot (alternativa al config). |
| `DSH_DISCORD_MODE` | `read-only`. |
| `DSH_DISCORD_API_BASE` | Base de la API (default `https://discord.com/api/v10`; para tests). |
| `DSH_DISCORD_SKIP_POSTINSTALL` | `1` omite el despliegue. |

## Solución de problemas

- **“falta el token”**: define `DISCORD_BOT_TOKEN` o completa el config.
- **403/401**: token inválido o el bot no está en el servidor/ canal.
- **“no hay canales permitidos”**: completa `allowedChannels`.
- **“ruta no permitida”**: agrega la carpeta en `allowedPaths`.
- **Permiso de scripts en la instalación**: aprueba el `postinstall`; si el
  cartel se repite, `allowBuilds: true` en `pnpm-workspace.yaml` del perfil.

## Desarrollo

```powershell
npm install
npm run build:bundle
cd test; npm install; node connect-test.mjs   # usa un mock local de la API de Discord
```

## Licencia

MIT © thegabopacheco-sudo
