# Transcription seuil audio

Prototype web statique pour enregistrer le micro quand le volume dépasse un seuil réglable, arrêter après un délai de silence réglable, puis récupérer le texte transcrit.

## Lancement

Depuis la racine du dépôt:

```powershell
python -m http.server 8787 --directory tools/audio-threshold-transcriber
```

Puis ouvrir `http://localhost:8787`.

Sur Android, héberger le dossier sur une URL HTTPS. Le micro ne fonctionne pas depuis une page HTTP distante.

## Permission micro durable

La durée de l'autorisation micro est contrôlée par le navigateur, pas par l'application.

- Windows Chrome/Edge: ouvrir les paramètres du site pour `http://localhost:8787` ou l'URL HTTPS utilisée, puis mettre `Microphone` sur `Autoriser`.
- Android Chrome: cadenas ou menu du site > Autorisations > Microphone > Autoriser.
- Utiliser toujours la même origine: même protocole, même domaine, même port. `http://localhost:8787` et `http://127.0.0.1:8787` sont deux sites différents pour le navigateur.
- Sur Android, installer la page comme appli PWA peut aider à garder une origine stable, mais ne permet pas de contourner les réglages du navigateur.

## Installation standalone sur Android

Cette application est une PWA. Elle peut apparaître comme une application autonome sur l'écran d'accueil Android, sans barre d'adresse, mais elle doit d'abord être ouverte depuis une origine HTTPS.

Procédure:

1. Héberger ce dossier sur une URL HTTPS, par exemple GitHub Pages, Netlify, Vercel, un serveur interne HTTPS ou un tunnel HTTPS.
2. Ouvrir cette URL dans Chrome Android.
3. Menu Chrome > `Ajouter à l'écran d'accueil` ou `Installer l'application`.
4. Ouvrir ensuite `Seuil Audio` depuis l'icône créée sur l'écran d'accueil.
5. Dans les paramètres du site ou de l'application installée, mettre `Microphone` sur `Autoriser`.

Le mode standalone ne transforme pas le projet en APK natif. C'est le navigateur Android qui exécute l'application installée. Après le premier chargement, les fichiers de l'interface sont mis en cache par le service worker, mais la transcription `SpeechRecognition` peut encore dépendre du service réseau du navigateur.

## Transcription sur Vercel

La transcription navigateur `SpeechRecognition` n'est pas fiable en PWA Android. Le projet inclut donc un endpoint Vercel:

```text
/api/transcribe
```

Il reçoit chaque segment audio `.webm` et l'envoie à l'API OpenAI Speech to Text.

Dans Vercel, ajouter ces variables d'environnement au projet:

```text
OPENAI_API_KEY=sk-...
TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

`TRANSCRIBE_MODEL` est optionnelle. Sans elle, l'endpoint utilise `gpt-4o-mini-transcribe`.

Après avoir ajouté ou modifié les variables, redéployer le projet Vercel. Ne jamais mettre la clé API dans `app.js` ou dans le navigateur.

Diagnostic:

```text
https://votre-app.vercel.app/api/health
```

La réponse doit contenir:

```json
{"ok":true,"openaiKeyConfigured":true,"model":"gpt-4o-mini-transcribe"}
```

Si `openaiKeyConfigured` vaut `false`, la variable `OPENAI_API_KEY` n'est pas disponible dans le déploiement actif.

## Notes techniques

- Enregistrement: `MediaRecorder`.
- Détection de niveau: `AudioContext` + `AnalyserNode`, calcul RMS en dB.
- Transcription: `SpeechRecognition` / `webkitSpeechRecognition` quand disponible.
- Transcription serveur: `/api/transcribe` sur Vercel, avec clé API en variable d'environnement.
- Le navigateur ne fournit pas d'API standard fiable pour transcrire un blob audio après coup sans moteur externe. Le prototype tente la reconnaissance vocale navigateur quand disponible, puis transcrit aussi les segments via l'endpoint serveur quand il existe.
- Français et anglais sont sélectionnables manuellement. La détection automatique de langue n'est pas standardisée côté navigateur.
