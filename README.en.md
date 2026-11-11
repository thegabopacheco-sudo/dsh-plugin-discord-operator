# dsh-plugin-discord-operator — Discord operator for DeepSeek Harness

A local MCP plugin to operate a Discord server from DSH: list channels, read
messages, send/edit messages and upload files with **explicit confirmation**,
**channel allowlist** and **audit**. It never reads DMs and never exposes the bot
token.

[Español](README.md) · [How it works](docs/HOW-IT-WORKS.md) · MIT

## Tools (6)

| Tool | Purpose |
|---|---|
| `mcp__discord__status` | Token configured (never shown), bot, guilds, mode, allowlists. |
| `mcp__discord__channels` | List text/announcement/forum channels (never DMs). |
| `mcp__discord__messages` | Read recent messages from a guild channel. |
| `mcp__discord__send` | Send a message (`confirm:true` + allowed channel). |
| `mcp__discord__edit` | Edit a bot message (`confirm:true` + allowed channel). |
| `mcp__discord__upload` | Upload a local file (`confirm:true` + allowed channel/path). |

## Token configuration

1. Host environment variable `DISCORD_BOT_TOKEN` (passed by the MCP row).
2. Local file `<DSH_HOME>\discord-operator\config.json`:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "guildId": "123456789012345678",
  "allowedChannels": ["announcements", "123456789012345678"],
  "allowedPaths": ["C:\\Users\\you\\.dsh\\cache"]
}
```

The `postinstall` creates an empty config for you to fill. Never commit the token.

## Install

From **DSH → Settings → Plugins** install
`github:thegabopacheco-sudo/dsh-plugin-discord-operator` and approve the install
script.

Or via CLI:

```
dsh plugin --profile <profile> add github:thegabopacheco-sudo/dsh-plugin-discord-operator
```

The `postinstall` deploys the runtime to `<DSH_HOME>\plugins\discord-operator` and
creates `<DSH_HOME>\discord-operator\config.json`.

Requirements: Windows 10/11, Node >= 20 (provided by the harness) and a **Discord
bot** with read/write permissions in the configured channels.

## Safety

- Read by default; writes require `confirm:true` and an explicit user request.
- Channel allowlist for writes; path allowlist for uploads.
- Never DMs: only guild channels (text/announcement/forum) are resolved.
- Audit log at `<DSH_HOME>\cache\discord-operator\audit.jsonl` (no content).
- 10 writes/minute rate limit.
- `DSH_DISCORD_MODE=read-only` disables send/edit/upload.
- The token is never returned by any tool or written to logs.

## Environment

| Variable | Use |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token (alternative to config). |
| `DSH_DISCORD_MODE` | `read-only`. |
| `DSH_DISCORD_API_BASE` | API base (default `https://discord.com/api/v10`; for tests). |
| `DSH_DISCORD_SKIP_POSTINSTALL` | `1` skips the deploy. |

## Troubleshooting

- **"token missing"**: set `DISCORD_BOT_TOKEN` or fill the config file.
- **401/403**: invalid token or bot missing from server/channel.
- **"no allowed channels"**: fill `allowedChannels`.
- **"path not allowed"**: add the folder to `allowedPaths`.
- **Install script permission**: approve the postinstall; if it loops, set
  `allowBuilds` entries to `true` in the profile's `pnpm-workspace.yaml`.

## Development

```powershell
npm install
npm run build:bundle
cd test; npm install; node connect-test.mjs   # local Discord API mock
```

## License

MIT © thegabopacheco-sudo
