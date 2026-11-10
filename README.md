# Nebula Visualizer

A real-time audio visualizer inspired by Monstercat's classic spectrum style. Load a song, add your own cover art and track info, and watch the bars and stars react to the music.

**[Live demo](https://nintobias.github.io/nebulaviz/)**

![Nebula Visualizer screenshot](preview.png)

## Features

- 63-band FFT spectrum that responds in real time to the current track
- Adjustable main color with optional gradient and color overlay styling
- Full background customization with solid color, gradient, gradient angle control, and optional background image
- Animated star field with controls for density, speed, boost, intensity, direction, and beat-triggered flash
- Sensitivity control for tuning the visual response to the music
- Custom cover art, artist name, track title, and extra info such as feat./remix text
- Full-screen view and hideable playback bar for a cleaner presentation
- Responsive layout that works on desktop and mobile

## How to use

1. Open the live demo (or `index.html` locally).
2. Click **Choose song** and pick an audio file (MP3, WAV or OGG).
3. Optionally add a cover image and edit the artist, title, or extra info fields.
4. Press play and use the editor panels to fine-tune the color, background, and star settings.
5. Toggle full-screen mode or hide the play bar when you want a more cinematic look.

Your audio and images are processed entirely in your browser. Nothing is uploaded anywhere.

## Built with

- Vanilla JavaScript (no frameworks or build step)
- Web Audio API (`AnalyserNode` for the FFT)
- Canvas 2D for rendering

## Project structure

- `index.html`: page markup
- `style.css`: layout and styling
- `script.js`: audio analysis, rendering and UI logic

## Notes

This is a fan-made tribute project and is not affiliated with Monstercat.