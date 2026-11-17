"""Marshmellow Mayhem – Lagerfeuer-Musik komponieren und rendern.

    python3 assets/music/compose.py [arbeitsordner]

Braucht: fluidsynth + FluidR3_GM.sf2 (apt: fluidsynth fluid-soundfont-gm), Python: mido, numpy; ffmpeg.
Erzeugt assets/music/campfire.mp3 (Gitarren, Bass, Mundharmonika/Pfeifen, Percussion, Lagerfeuer-Knistern)
und assets/music/campfire-tension.mp3 (Klatschen/Tamburin/Stampfen für die letzten Züge).

Nahtlose Schleife: Das Stück wird 3x hintereinander gerendert. Aus dem mittleren Durchgang wird eine exakt
LOOP_SECONDS lange Schleife gebaut, deren Anfang per Überblendung (250 ms) in die natürliche Fortsetzung des
Endes übergeht – also kein Knacken. Exportiert wird die Schleife plus PAD Sekunden davor/danach (exakt
periodisch), damit Abspielen von PAD bis PAD+LOOP_SECONDS lückenlos ist, auch wenn der MP3-Decoder ein paar
Samples verschiebt.
"""
import json
import random
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import mido
import numpy as np

HERE = Path(__file__).resolve().parent
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
SR = 44100
BPM = 90                       # 90 BPM → ein Takt = 2,666… s, 40 Takte = exakt 4 704 000 Samples
TPB = 480                      # Ticks pro Viertel
BAR = TPB * 4
PAD = 1.0                      # Sekunden echter Musik vor/nach der Schleife (für nahtloses Loopen)
rng = random.Random(1907)      # fester Zufall → jedes Rendern klingt gleich

# ---------------------------------------------------------------- Harmonien (Gitarrengriffe, tief → hoch)
CHORDS = {
    'G': [43, 47, 50, 55, 59, 67],
    'D': [50, 57, 62, 66],
    'Em': [40, 47, 52, 55, 59, 64],
    'C': [48, 52, 55, 60, 64],
    'Am': [45, 52, 57, 60, 64],
}
BASS = {'G': (43, 38), 'D': (38, 45), 'Em': (40, 47), 'C': (36, 43), 'Am': (45, 40)}  # Grundton, Quinte

# Form: (Abschnitt, Akkorde je Takt)
VERSE = ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C']
CHORUS = ['C', 'G', 'D', 'Em', 'C', 'G', 'D', 'D']
FORM = [
    ('intro', ['G', 'Em', 'C', 'D']),
    ('verse1', VERSE),
    ('chorus1', CHORUS),
    ('verse2', VERSE),
    ('chorus2', CHORUS),
    ('outro', ['G', 'Em', 'C', 'D']),
]
BARS = sum(len(c) for _, c in FORM)                    # 40 Takte
LOOP_TICKS = BARS * BAR
LOOP_SECONDS = BARS * 4 * 60 / BPM

# Melodien: (MIDI-Note oder None für Pause, Dauer in Vierteln) – G-Dur, volkstümlich
MEL_VERSE = [
    (71, 1), (74, 1), (74, .5), (71, .5), (69, 1),
    (69, 2), (66, 1), (69, 1),
    (67, 1), (71, 1), (71, .5), (69, .5), (67, 1),
    (64, 3), (None, 1),
    (71, 1), (74, 1), (74, .5), (76, .5), (79, 1),
    (78, 1.5), (76, .5), (74, 2),
    (76, 1), (74, 1), (71, 1), (67, 1),
    (69, 3), (None, 1),
]
MEL_CHORUS = [
    (76, 1.5), (74, .5), (72, 1), (76, 1),
    (74, 2), (71, 1), (74, 1),
    (69, 1.5), (71, .5), (69, 1), (66, 1),
    (67, 3), (None, 1),
    (76, 1), (79, 1), (79, .5), (76, .5), (74, 1),
    (74, 1.5), (71, .5), (74, 2),
    (69, 1), (71, 1), (72, 1), (69, 1),
    (74, 4),
]

# GM-Instrumente / Kanäle
CH = {'strum': 0, 'pick': 1, 'bass': 2, 'harm': 3, 'whistle': 4, 'harm2': 5, 'drums': 9}
PROGRAM = {'strum': 25, 'pick': 24, 'bass': 32, 'harm': 22, 'whistle': 78, 'harm2': 22}
VOLUME = {'strum': 92, 'pick': 80, 'bass': 98, 'harm': 70, 'whistle': 66, 'harm2': 46, 'drums': 78}
PAN = {'strum': 50, 'pick': 82, 'bass': 64, 'harm': 58, 'whistle': 70, 'harm2': 46, 'drums': 64}
REVERB = {'strum': 50, 'pick': 60, 'bass': 20, 'harm': 75, 'whistle': 85, 'harm2': 80, 'drums': 40}


def human(ticks, amount=9):
    """Etwas Ungenauigkeit wie beim echten Spielen (± ~12 ms)."""
    return max(0, ticks + rng.randint(-amount, amount))


def vel(v, spread=8):
    return max(1, min(127, v + rng.randint(-spread, spread)))


# ---------------------------------------------------------------- Noten erzeugen (absolute Ticks)

def section_bars():
    bar = 0
    for name, chords in FORM:
        for k, ch in enumerate(chords):
            yield name, k, bar, ch
            bar += 1


def strum_part(notes):
    """Steelstring-Gitarre: Muster D–DU–UDU, echte Anschläge (Saiten nacheinander)."""
    pattern = [(0, 'D'), (2, 'D'), (3, 'U'), (5, 'U'), (6, 'D'), (7, 'U')]  # Positionen in Achteln
    stagger = 8  # Ticks zwischen zwei Saiten (≈ 11 ms)
    for name, k, bar, ch in section_bars():
        if name == 'intro':
            continue
        soft = name == 'outro'
        strings = CHORDS[ch]
        for idx, (pos, d) in enumerate(pattern):
            start = bar * BAR + pos * (TPB // 2)
            nxt = pattern[idx + 1][0] if idx + 1 < len(pattern) else 8
            length = (nxt - pos) * (TPB // 2) - 20
            accent = pos in (0, 6)
            if d == 'D':
                order = strings
                v = (74 if accent else 64) - (14 if soft else 0)
            else:
                order = list(reversed(strings[-4:]))
                v = 50 - (10 if soft else 0)
            t0 = human(start, 6)
            for s, n in enumerate(order):
                notes.append(('strum', t0 + s * stagger, length - s * stagger, n, vel(v - s * 2, 5)))


def pick_part(notes):
    """Nylongitarre gezupft (Daumen Bass, Finger Diskant) – Intro, Refrains, Outro."""
    for name, k, bar, ch in section_bars():
        if name not in ('intro', 'chorus1', 'chorus2', 'outro'):
            continue
        strings = CHORDS[ch]
        bass1, bass2 = strings[0], strings[1]
        top = strings[-3:]
        seq = [bass1, top[0], top[1], top[2], bass2, top[0], top[1], top[0]]
        loud = 66 if name in ('intro', 'outro') else 52
        for i, n in enumerate(seq):
            start = bar * BAR + i * (TPB // 2)
            notes.append(('pick', human(start, 7), TPB // 2 * (3 if i in (0, 4) else 2), n + 12 if i not in (0, 4) else n,
                          vel(loud + (8 if i in (0, 4) else 0), 6)))


def bass_part(notes):
    for name, k, bar, ch in section_bars():
        if name == 'intro':
            continue
        root, fifth = BASS[ch]
        b = bar * BAR
        notes.append(('bass', human(b, 5), int(TPB * 1.4), root, vel(84)))
        notes.append(('bass', human(b + int(TPB * 1.5), 5), TPB // 2 - 20, root, vel(62)))
        notes.append(('bass', human(b + 2 * TPB, 5), int(TPB * 1.4), fifth, vel(76)))
        if k % 2 == 1:  # kleiner Lauf zum nächsten Akkord
            notes.append(('bass', human(b + int(3.5 * TPB), 5), TPB // 2 - 20, fifth + 2, vel(60)))


def melody(notes, inst, phrase, start_bar, octave=0, softer=0):
    t = start_bar * BAR
    for n, dur in phrase:
        ticks = int(dur * TPB)
        if n is not None:
            notes.append((inst, human(t, 8), ticks - 30, n + octave, vel(84 - softer, 7)))
        t += ticks


def melody_parts(notes):
    bar_of = {}
    bar = 0
    for name, chords in FORM:
        bar_of[name] = bar
        bar += len(chords)
    # Vers 1: Mundharmonika steigt erst in der zweiten Hälfte ein (Takte 5–8 = zweite Phrase)
    melody(notes, 'harm', MEL_VERSE[15:], bar_of['verse1'] + 4)
    melody(notes, 'whistle', MEL_CHORUS, bar_of['chorus1'])
    melody(notes, 'harm', MEL_VERSE, bar_of['verse2'])
    melody(notes, 'whistle', MEL_CHORUS, bar_of['chorus2'])
    melody(notes, 'harm2', [(n - 4 if n else None, d) for n, d in MEL_CHORUS], bar_of['chorus2'], softer=10)


def drum_part(notes, tension=False):
    """Percussion: Shaker, Stampfen, Cajón-artiger Side-Stick. tension=True → Klatschen/Tamburin."""
    for name, k, bar, ch in section_bars():
        b = bar * BAR
        if tension:
            for beat in range(4):
                notes.append(('drums', human(b + beat * TPB, 4), 120, 35, vel(88)))           # Stampfen
                if beat in (1, 3):
                    notes.append(('drums', human(b + beat * TPB, 6), 120, 39, vel(92)))       # Klatschen
                    notes.append(('drums', human(b + beat * TPB + 12, 6), 120, 39, vel(70)))  # zweiter Klatscher
            for e in range(8):
                notes.append(('drums', human(b + e * (TPB // 2), 4), 100, 54, vel(66 if e % 2 else 54)))  # Tamburin
            continue
        if name == 'intro':
            continue
        quiet = name in ('outro', 'verse1')
        for e in range(8):
            notes.append(('drums', human(b + e * (TPB // 2), 5), 100, 70, vel((40 if e % 2 else 28) - (8 if quiet else 0), 5)))  # Maracas
        if name in ('chorus1', 'chorus2', 'verse2'):
            notes.append(('drums', human(b, 4), 120, 35, vel(72)))
            notes.append(('drums', human(b + 2 * TPB, 4), 120, 35, vel(60)))
            notes.append(('drums', human(b + TPB, 5), 100, 37, vel(52)))
            notes.append(('drums', human(b + 3 * TPB, 5), 100, 37, vel(56)))


# ---------------------------------------------------------------- MIDI schreiben & rendern

def write_midi(notes, path, copies=3):
    mid = mido.MidiFile(ticks_per_beat=TPB)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(BPM), time=0))
    used = sorted({inst for inst, *_ in notes})
    for inst in used:
        c = CH[inst]
        if inst in PROGRAM:
            track.append(mido.Message('program_change', channel=c, program=PROGRAM[inst], time=0))
        track.append(mido.Message('control_change', channel=c, control=7, value=VOLUME[inst], time=0))
        track.append(mido.Message('control_change', channel=c, control=10, value=PAN[inst], time=0))
        track.append(mido.Message('control_change', channel=c, control=91, value=REVERB[inst], time=0))
        track.append(mido.Message('control_change', channel=c, control=93, value=20, time=0))
    events = []
    for copy in range(copies):
        off = copy * LOOP_TICKS
        for inst, start, length, note, v in notes:
            c = CH[inst]
            events.append((off + start, 1, mido.Message('note_on', channel=c, note=note, velocity=v)))
            events.append((off + start + max(30, length), 0, mido.Message('note_off', channel=c, note=note, velocity=0)))
    # Ende: einen Takt Ausklang, damit der letzte Durchgang nicht abgeschnitten wird
    end = copies * LOOP_TICKS + BAR
    events.sort(key=lambda e: (e[0], e[1]))
    now = 0
    for t, _, msg in events:
        msg.time = t - now
        now = t
        track.append(msg)
    track.append(mido.MetaMessage('end_of_track', time=end - now))
    mid.save(path)


def render(mid_path, wav_path):
    subprocess.run([
        'fluidsynth', '-ni', '-q', '-g', '0.55', '-r', str(SR),
        '-o', 'synth.reverb.room-size=0.62', '-o', 'synth.reverb.damp=0.4', '-o', 'synth.reverb.width=0.9',
        '-o', 'synth.reverb.level=0.75', '-o', 'synth.chorus.active=1',
        '-F', str(wav_path), SF2, str(mid_path),
    ], check=True)


def read_wav(path):
    with wave.open(str(path)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return data.reshape(-1, w.getnchannels())


def write_wav(path, data):
    data = np.clip(data, -1, 1)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((data * 32767).astype('<i2').tobytes())


def make_loop(audio, loop_n, fade_s=0.25):
    """Mittleren Durchgang als exakt periodische Schleife (Anfang überblendet mit der Fortsetzung des Endes)."""
    need = 3 * loop_n
    if len(audio) < need:
        audio = np.pad(audio, ((0, need - len(audio)), (0, 0)))
    y = audio[loop_n:2 * loop_n].copy()
    x = round(fade_s * SR)
    t = np.linspace(0, np.pi / 2, x)[:, None]
    y[:x] = audio[2 * loop_n:2 * loop_n + x] * np.cos(t) + audio[loop_n:loop_n + x] * np.sin(t)
    return y


def campfire(n):
    """Lagerfeuer: tiefes Rauschen + zufälliges Knacken (periodisch mit Länge n)."""
    r = np.random.default_rng(7)
    rumble = r.standard_normal(n)
    # Tiefpass (einfacher IIR) für das Fauchen der Flammen
    out = np.empty(n)
    acc = 0.0
    a = 0.02
    for i in range(0, n, 1):
        acc += a * (rumble[i] - acc)
        out[i] = acc
    out *= 0.35 / (np.abs(out).max() + 1e-9)
    # Knacken: kurze, gefilterte Impulse, mal leiser, mal lauter, in Grüppchen
    crack = np.zeros(n)
    t = 0
    while t < n - 2000:
        t += int(r.exponential(0.22) * SR) + 200
        if t >= n - 2000:
            break
        burst = r.integers(1, 4)
        for b in range(burst):
            pos = t + b * int(r.integers(300, 2500))
            if pos >= n - 1500:
                break
            ln = int(r.integers(80, 900))
            env = np.exp(-np.linspace(0, r.uniform(4, 9), ln))
            crack[pos:pos + ln] += r.standard_normal(ln) * env * r.uniform(0.15, 0.9)
    # Hochpass fürs Knacken (Differenz) und mischen
    crack = np.diff(crack, prepend=0) * 0.8
    fire = out * 0.6 + crack
    fire /= np.abs(fire).max() + 1e-9
    return np.stack([fire, np.roll(fire, 211)], axis=1)  # leicht breites Stereobild


def encode(wav_path, mp3_path, gain_db, bitrate):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(wav_path),
                    # Kerbfilter gegen eine Resonanz der Mundharmonika-/Gitarren-Samples bei 1480 Hz (F#6)
                    '-af', f'highpass=f=35,equalizer=f=1480:t=q:w=12:g=-10,equalizer=f=2960:t=q:w=12:g=-4,'
                           f'volume={gain_db:.2f}dB,alimiter=limit=0.89:level=false',
                    '-c:a', 'libmp3lame', '-b:a', bitrate, str(mp3_path)], check=True)


def loudness(wav_path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(wav_path), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return json.loads(out[out.rindex('{'):out.rindex('}') + 1])


def main():
    work = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp())
    work.mkdir(parents=True, exist_ok=True)

    main_notes = []
    strum_part(main_notes)
    pick_part(main_notes)
    bass_part(main_notes)
    melody_parts(main_notes)
    drum_part(main_notes)
    tension_notes = []
    drum_part(tension_notes, tension=True)

    loop_n = round(LOOP_SECONDS * SR)
    pad_n = round(PAD * SR)
    stems = {}
    for name, notes in (('main', main_notes), ('tension', tension_notes)):
        mid = work / f'{name}.mid'
        wav = work / f'{name}-raw.wav'
        write_midi(notes, mid)
        render(mid, wav)
        audio = read_wav(wav)
        stems[name] = make_loop(audio, loop_n)
        print(f'{name}: gerendert {len(audio) / SR:.1f}s → Schleife {loop_n / SR:.3f}s + 2×{PAD}s')

    # Lagerfeuer (periodisch) unter die Hauptspur, dann beide Spuren mit Rand exportieren
    stems['main'] = stems['main'] + campfire(loop_n) * 0.05
    for name in stems:
        y = stems[name]
        stems[name] = np.concatenate([y[-pad_n:], y, y[:pad_n]])

    # Lautheit: Hauptspur auf ca. -19 LUFS (Hintergrund), Spannungsspur mit derselben Verstärkung
    raw_main = work / 'main-seg.wav'
    write_wav(raw_main, stems['main'] / max(1e-9, np.abs(stems['main']).max()) * 0.9)
    scale = 0.9 / max(1e-9, np.abs(stems['main']).max())
    lm = loudness(raw_main)
    gain = -19.0 - float(lm['input_i'])
    print(f'Hauptspur: {float(lm["input_i"]):.1f} LUFS gemessen → {gain:+.1f} dB')
    raw_t = work / 'tension-seg.wav'
    write_wav(raw_t, stems['tension'] * scale)

    out = HERE
    encode(raw_main, out / 'campfire.mp3', gain, '112k')
    encode(raw_t, out / 'campfire-tension.mp3', gain + 7, '80k')
    meta = {'loopSeconds': LOOP_SECONDS, 'pad': PAD, 'bpm': BPM, 'bars': BARS}
    (out / 'music.json').write_text(json.dumps(meta, indent=2) + '\n')
    print('fertig:', meta)


if __name__ == '__main__':
    main()
