# StreamSC Extensions

Repository ufficiale delle estensioni (`.scext`) per **StreamSC**.

Ogni cartella `*.scext` contiene:
- `manifest.json` — metadati del provider, sezioni Home e capabilities
- `provider.js` — logica di scraping/risoluzione stream in JavaScript
- `icon.png` — icona del provider

StreamSC scarica e aggiorna automaticamente tutte le estensioni presenti in questo repository a ogni modifica su `main`.
