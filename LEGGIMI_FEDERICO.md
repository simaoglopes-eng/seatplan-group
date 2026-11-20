# SeatPlan: apertura in Visual Studio Code

Questa è la copia personale e indipendente di SeatPlan. Il sito e la repository del gruppo non sono collegati.

## Stato (16 novembre 2026)

- Interfaccia in inglese pubblicata su https://seatplan-events-federico.vercel.app/.
- Backend FastAPI pubblicato sullo stesso progetto Vercel personale.
- Neon collegato; il controllo live conferma `database: ok` e `schema: ready`.
- Le email reali non sono ancora configurate. Non usare la registrazione con utenti reali finché non è stato collegato e verificato un provider email.

## Aprire il progetto

1. In VS Code seleziona **File > Open Folder / Apri cartella** e scegli `seatplan-events`.
2. Apri il terminale integrato e controlla `pwd`, `git status` e `git remote -v` prima di modificare o pubblicare.
3. Per avviare e testare il progetto, segui il README e [la guida di setup](docs/INDEPENDENT_SETUP.md). Servono Node.js 22 o successivo e Python 3.12. Le istruzioni demo descrivono il database locale, non l'ambiente live.
4. Non inserire password o stringhe di connessione nella chat o nei file tracciati da Git. Conserva i segreti nelle variabili d'ambiente locali e Vercel; usa un database di sviluppo separato dai dati reali.
