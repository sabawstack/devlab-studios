# Client consent register

Spec K.2 and CASE-04; owner decision Q-16 (2026-11-13: no client named).

A write-up may show a client's name, logo or a quote only when the client has
agreed in writing. This file is the human record; `src/config/clientConsent.js`
is what the site checks, and `src/config/clientConsent.test.js` fails if a
write-up names a client without an entry.

| Write-up | Client named | Quote | Consent date | Where the consent is kept |
|---|---|---|---|---|
| Memory Preview | No (internal system) | No | — | — |
| Automated lead qualification | No | No | — | — |
| Wholesaling buyer intelligence | No | No | — | — |
| Messenger AI agent | No | No | — | — |

To add a client: get written consent (email is enough), store it outside this
public repository, add a row here and an entry in `CLIENT_CONSENT`, then add
the name to the write-up in the admin.
