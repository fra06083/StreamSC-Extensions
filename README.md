# StreamSC Extensions

Repository ufficiale delle estensioni (`.scext`) per **StreamSC**.

Ogni cartella `*.scext` contiene:
- `manifest.json` — metadati del provider, sezioni Home e capabilities
- `provider.js` — logica di scraping/risoluzione stream in JavaScript
- `icon.png` — icona del provider

StreamSC scarica e aggiorna automaticamente tutte le estensioni presenti in questo repository a ogni modifica su `main`.

## Dominio StreamingCommunity

Il dominio ufficiale cambia spesso. Il workflow
`.github/workflows/update-streamingcommunity-domain.yml` legge il canale
Telegram ufficiale [`@Streaming_community_sito`](https://t.me/Streaming_community_sito),
valida il nuovo dominio e aggiorna automaticamente `manifest.json` e
`provider.js` (con bump di versione) ogni volta che cambia.

Esecuzione manuale:

```bash
python3 scripts/update_streamingcommunity_domain.py --dry-run
python3 scripts/update_streamingcommunity_domain.py
```
