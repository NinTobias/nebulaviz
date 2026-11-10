# Nebula Visualizer

A real-time audio visualizer inspired by Monstercat's classic spectrum style. Load a song, add your own cover art and track info, and watch the bars and stars react to the music.

**[Live demo](https://nintobias.github.io/nebulaviz/)**

![Nebula Visualizer screenshot](preview.png)

## Features

- 63-bar frequency spectrum driven by an FFT of the playing audio
- Main color and optional gradient, each with a hue wheel and RGB/hex inputs
- Custom background color
- Star field that speeds up and lights up on bass hits, with controls for density, speed, boost, intensity and direction
- Adjustable sensitivity
- Custom cover art, artist, title and extra info (feat./remix) text
- Full screen mode and a hideable play bar
- Responsive layout that works on desktop and mobile

## How to use

1. Open the live demo (or `index.html` locally).
2. Click **Choose song** and pick an audio file (MP3, WAV or OGG).
3. Optionally add a cover image and edit the artist and title.
4. Press play and tweak the colors and star settings.

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