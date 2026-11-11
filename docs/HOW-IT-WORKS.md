# How dsh-plugin-discord-operator works

A Discord operator for DeepSeek Harness: read guild channels and messages and
write (messages/edits/uploads) with confirmation, allowlists and audit. It never
touches DMs and never exposes the bot token.

## API and authentication

- Talks to **Discord REST API v10** over HTTPS with native `fetch`; no SDK.
- Token from `DISCORD_BOT_TOKEN` in the host environment or `token` in
  `<DSH_HOME>\discord-operator\config.json`.
- The bundle MCP row forwards `DISCORD_BOT_TOKEN` explicitly because the MCP
  client scrubs sensitive ambient variables from the child env by default.
- The token is never returned by a tool nor written to logs; `status` only reports
  the source (`env` or `config.json`).

## Tools

| Tool | Flow |
|---|---|
| `status` | Read config (no token), query `/users/@me` and `/users/@me/guilds`. |
| `channels` | Resolve guild, `GET /guilds/{id}/channels`, keep text (0), announcement (5), forum (15). |
| `messages` | Resolve channel by id/name inside the guild, `GET /channels/{id}/messages?limit=N`. |
| `send` | `confirm:true` → allowlisted channel → `POST /channels/{id}/messages`. |
| `edit` | `confirm:true` → allowed channel → `PATCH /channels/{id}/messages/{id}`. |
| `upload` | `confirm:true` → allowed channel → path inside `allowedPaths` → multipart `POST` with `FormData`/`Blob`. |

## Safety layers

1. **Never DMs**: channels are resolved inside the guild only; DM (1) and group DM
   (3) types never appear.
2. **Confirmation**: `send`/`edit`/`upload` require `confirm:true`; instructions
   ask for explicit user confirmation.
3. **Channel allowlist**: empty `allowedChannels` means no writes.
4. **Path allowlist**: uploads only from `allowedPaths` (≤ 20 MB).
5. **Rate limit**: 10 writes/minute.
6. **Audit**: each write records channel, length/size and message id (no content).
7. **Read-only**: `DSH_DISCORD_MODE=read-only` disables writes.

## Configuration

```json
{
  "token": "…",
  "guildId": "123",
  "allowedChannels": ["announcements", "123"],
  "allowedPaths": ["C:\\Users\\you\\.dsh\\cache"]
}
```

## Validation

- **End-to-end test against a local Discord API mock**: status, channels (DMs and
  voice excluded), messages, send without confirmation (rejected), send to a
  non-allowed channel (rejected), send OK, edit OK, multipart upload OK and
  read-only mode.
- **Packaged artifact**: `npm pack` → extract → `postinstall` (deploy + empty
  config) → deployed server answers `status` and `channels` against the mock.

No real Discord server is touched without a token.
