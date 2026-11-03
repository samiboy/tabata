# Tabata Timer

A tabata timer web page. It says the round, "Go!" and "Rest", and beeps 3-2-1 before each change.
All sounds use the Web Audio API, so music or a podcast in another app keeps playing.

## Use on Android

1. Open the page in Chrome.
2. Tap the menu (⋮), then tap "Add to Home screen" or "Install app".
3. Open the timer from the icon. It also works offline.

## Develop

- Run the tests: `npm test`
- Run the page on this computer: `python3 -m http.server 8765`, then open http://localhost:8765
- Make the voice again (macOS, needs ffmpeg): `python3 tools/make_voice.py --voice Daniel`

After you change a file, reload the page two times. The first load comes from the offline cache.
