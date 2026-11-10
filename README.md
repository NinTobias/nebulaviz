# Nebula Visualizer

A real-time audio visualizer inspired by Monstercat's classic spectrum aesthetic. Load a song, add custom art and track details, and watch the visualizer react to the beat, bass, and melody in real time.

**[Live demo](https://nintobias.github.io/nebulaviz/)**

![Nebula Visualizer screenshot](preview.png)

## Overview

Nebula Visualizer is a browser-based music visualizer built with the Web Audio API and Canvas. It started as a classic 63-bar spectrum inspired by early Monstercat style visuals, and has since evolved into a much more flexible "visualizer studio" with multiple display modes, theme controls, presets, and project export features.

**Your audio and images are processed entirely in your browser. Nothing is uploaded anywhere.**

## Highlights

- Multiple visualizer modes: standard spectrum, circular spectrum, mirrored spectrum, smooth wave, LED matrix, and ridgeline renderers
- Audio-reactive motion tuned with sensitivity controls and bass-driven pulses
- Full customization for the main color, gradient, background color, and background gradient angle
- Optional background image support and custom cover art uploads
- Animated star field with density, speed, boost, intensity, direction, and beat flash controls
- Preset system with built-in looks and custom JSON project import/export
- Screenshot capture and video export support for saving visualizer output
- Full-screen mode and hideable playback bar for a cleaner presentation
- Responsive layout for desktop and mobile use

## Visualizer modes

| Mode | Description | Best for |
| --- | --- | --- |
| 63-Bar Spectrum | Classic bar-based FFT display with the original Nebula look | The signature Monstercat-inspired experience |
| Circular Spectrum | Frequency bars arranged around a circular center | More cinematic, radial energy visuals |
| Mirrored Spectrum | Symmetrical bar layout with adjustable bar count | Balanced and wide-screen presentation |
| Smooth Wave | Continuous flowing waveform shape | Softer, more ambient music reactions |
| Mirrored Smooth Wave | Two mirrored waves for a layered, polished look | Dynamic stereo-like motion |
| LED Matrix | Dots/LED-style frequency grid with optional falling peak behavior | Retro club or synthwave presentation |
| Ridgeline | Layered terrain-like waveform plot | Rich, atmospheric, and rhythmic motion |

## Feature set

### Audio and visual controls

- Real-time audio analysis using `AnalyserNode`
- Sensitivity control to tune how strongly the music affects the visuals
- Bass pulse option for cover art and background reactivity
- Adjustable star field motion, density, glow, and direction
- Visual mode switching without leaving the page

### Styling and theming

- Main color picker with hex/RGB inputs and hue wheel
- Optional gradient mode with secondary end color
- Background color and background gradient options
- Background direction dial for precise gradient angle control
- Background image overlay support
- Dual overlay colors and gradient styling for UI accenting

### Presets and project packaging

- Built-in presets: `Default Nebula`, `Cyberpunk Neon`, `Sunset Vibes`, and `Minimal Mono`
- Save current appearance as a preset
- Export the current project as JSON
- Import a saved JSON project configuration
- Optional randomize-on-new-song behavior

### Playback and output tools

- Play/pause and seek controls
- Adjustable volume and mute toggling
- Save still-frame screenshots as PNG
- Export motion clips as WebM/MP4 (browser-supported media capture)
- Full-screen toggle and floating UI bar controls

## How to use

1. Open the live demo or launch `index.html` locally in a browser.
2. Click **Choose song** and select an audio file (MP3, WAV, or OGG).
3. Optionally upload a cover image and edit the artist, title, and extra info fields.
4. Press play and choose a visualizer mode from the **Visualizer** panel.
5. Tweak sensitivity, colors, background, and star settings to match the mood of the track.
6. Save a preset, export a project, or capture a screenshot/video when you like the result.

## Project structure

- `index.html`: application UI and controls
- `style.css`: layout, theming, and visual styling
- `script.js`: audio analysis, rendering, presets, export/import logic, and visualizer behaviors

## Built with

- Vanilla JavaScript
- Web Audio API (`AnalyserNode` and audio buffers)
- HTML Canvas 2D rendering
- No framework or build step required

## Notes

This is a fan-made tribute project and is not affiliated with Monstercat.