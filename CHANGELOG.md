# Changelog

## 0.1.0 — 2026-11-11

- Primera versión pública de **dsh-plugin-discord-operator**.
- Tools: `status`, `channels`, `messages`, `send`, `edit`, `upload`.
- API de Discord v10 con token por entorno o `config.json` (nunca expuesto).
- Solo canales de servidor: nunca DMs.
- Escrituras con `confirm:true`, lista blanca de canales y de rutas, rate limit y
  auditoría.
- Modo `read-only`, bundle single-file, `postinstall` con config vacía, tests
  end-to-end contra mock local y workflow de publicación.
