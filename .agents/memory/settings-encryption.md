---
name: Settings at-rest encryption
description: Azure keys in app_settings are AES-256-GCM encrypted, keyed from SESSION_SECRET
---

- Values in `app_settings` written via the Settings page are stored as `enc:v1:<iv>:<tag>:<ciphertext>`, keyed from SESSION_SECRET (scrypt, static salt).
- **Why:** DB backups/exports must not contain readable Azure API keys; user chose this over a Key Vault migration.
- **How to apply:** All reads/writes must go through `loadAzureSettings`/`saveAzureSettings` — never query `app_settings` values directly. Legacy plaintext rows migrate on read (optimistic, key+value match). Saves fail closed (503) if SESSION_SECRET is unset. If SESSION_SECRET changes, saved keys become unreadable and must be re-entered — the Azure deployment guide tells IT to keep it stable.
