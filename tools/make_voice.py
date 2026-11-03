#!/usr/bin/env python3
"""Make voice.mp3 and voice.json: all spoken cues in one audio file.

voice.json gives each cue as [start, length] in seconds inside voice.mp3.
Needs macOS `say` and `ffmpeg`.

    python3 tools/make_voice.py
    python3 tools/make_voice.py --voice Daniel
"""
import argparse
import array
import pathlib
import subprocess
import tempfile
import wave

RATE = 24000
GAP = 0.3          # silence between cues in voice.mp3, in seconds
THRESHOLD = 300    # 16-bit samples below this level count as silence
MAX_ROUNDS = 30    # keep the same as LIMITS in timeline.js
MAX_SETS = 10
ROOT = pathlib.Path(__file__).resolve().parent.parent


def phrases():
    cues = {'get_ready': 'Get ready', 'go': 'Go!', 'rest': 'Rest',
            'last_round': 'Last round', 'done': 'Workout complete'}
    cues.update({f'round_{n}': f'Round {n}' for n in range(1, MAX_ROUNDS + 1)})
    cues.update({f'set_{n}': f'Set {n}' for n in range(2, MAX_SETS + 1)})
    return cues


def speak(text, voice, path):
    """Return the spoken text as 16-bit samples, without silence at the ends, at -1 dB peak."""
    subprocess.run(['say', '-v', voice, '-o', str(path), f'--data-format=LEI16@{RATE}', text], check=True)
    with wave.open(str(path)) as w:
        samples = array.array('h', w.readframes(w.getnframes()))
    loud = [i for i, v in enumerate(samples) if abs(v) > THRESHOLD]
    clip = samples[max(0, loud[0] - int(0.02 * RATE)):loud[-1] + int(0.05 * RATE)]
    scale = 0.89 * 32767 / max(abs(v) for v in clip)
    return array.array('h', (int(v * scale) for v in clip))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--voice', default='Samantha', help='one of the voices from: say -v "?"')
    args = parser.parse_args()

    gap = array.array('h', bytes(2 * int(GAP * RATE)))
    sprite = array.array('h')
    index = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        for name, text in phrases().items():
            clip = speak(text, args.voice, tmp / f'{name}.wav')
            sprite.extend(gap)
            index.append(f'  "{name}": [{len(sprite) / RATE:.3f}, {len(clip) / RATE:.3f}]')
            sprite.extend(clip)
        sprite.extend(gap)

        wav = tmp / 'voice.wav'
        with wave.open(str(wav), 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(sprite.tobytes())
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-b:a', '48k',
                        str(ROOT / 'voice.mp3')], check=True)

    (ROOT / 'voice.json').write_text('{\n' + ',\n'.join(index) + '\n}\n')
    print(f'voice.mp3: {len(index)} cues, {len(sprite) / RATE:.1f} s')


if __name__ == '__main__':
    main()
