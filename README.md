<br>
<br>
<br>
<br>
<p align="center">
  <img src="./assets/icon.png" alt="YiPop Logo" width="96" height="96" onerror="this.style.display='none'"/>
</p>
<h1 align="center">YiPop</h1>
<h3 align="center">A simple and beautiful H5 Popstar.</h3>

<p align="center">A clean, lightweight, and privacy-first 消灭星星 (Popstar!) game, crafted with Material You and modern web engineering.</p>
<p align="center">Made with ❤️ by <a href="https://github.com/lingyicute">lingyicute</a>.</p>
<br>
<br>
<p align="center">
  [🇺🇸 English] •
  <a href="https://github.com/lingyicute/YiPop">🌐 Source Code</a> •
  <a href="https://github.com/lingyicute/YiPop/issues">🐛 Report Bug</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-orange.svg" alt="License: AGPL-3.0"></a>
  <a href="index.html"><img src="https://img.shields.io/badge/Single%20File-138%20KB-blue" alt="Single File 138 KB"></a>
  <a href="https://github.com/lingyicute/YiPop"><img src="https://img.shields.io/badge/Dependencies-Zero-brightgreen" alt="Zero Dependencies"></a>
  <a href="https://github.com/lingyicute/YiPop"><img src="https://img.shields.io/badge/Ads%20%26%20Trackers-Zero-brightgreen" alt="No Ads No Tracking"></a>
  <a href="https://github.com/lingyicute/YiPop"><img src="https://img.shields.io/github/stars/lingyicute/YiPop?style=flat&color=yellow" alt="GitHub Stars"></a>
</p>
<br>

## 📖 Overview

Popstar games are deceptively simple — until you actually try to write one. Most web versions only get the collapse rule half right, never show you what a click is worth, and stop being interesting after the first board.

**YiPop** is the full version: **four board sizes**, colour-aware group detection, a live **+N preview** before you commit, chained explosions in real propagation order, a collapsing board with left-shifting columns, and a **leftover-star bonus** that rewards a clean finish. It ships as **one self-contained HTML file** — and it even synthesises its own sound effects, so there is no audio asset to download.

<br>

## ✨ Features

- **💥 The Popstar Rule Set, Done Right**
  - Groups are formed by **orthogonal** adjacency (diagonals never count); clicking a group of two or more pops it.
  - Scoring is **n² × 5** — so grouping twelve stars (720 points) beats popping six groups of two (120 points). Big groups are always the right plan.
  - After each pop the board **collapses** downward and **empty columns slide left**, bringing new neighbours together.
  - Boards are generated with at least one valid move, and play ends when none remains.

- **🎯 Four Board Sizes with Target Scores**
  - **简单 Easy** 8×8 / 4 colours / target 2,500 · **中等 Medium** 10×10 / 5 / 4,500 · **困难 Hard** 12×12 / 6 / 7,000 · **专家 Expert** 14×14 / 6 / 10,000.
  - A progress bar tracks your score against the target in real time.

- **🏆 Clear, Honest Feedback**
  - **Group preview** — hovering or focusing a star highlights the entire group it would pop and floats a **+N** score, so you never click blind.
  - **Chain explosions** — removals run in BFS order, so each star visibly ignites its neighbours; particles, blast rings and a combo flash punctuate big groups.
  - **Leftover bonus** — finishing with fewer than 10 stars left pays a bonus (2000 − n²×20), so it pays to plan the endgame.
  - **Undo** (`Z`) and **instant restart** (`R`), both one keystroke away.

- **🔊 Sound Without Audio Files**
  - Effects are **synthesised at runtime** with the Web Audio API — pitch and duration scale with the size of the group you pop.
  - Audio unlocks on first interaction (per browser policy) and can be switched off from the menu.

- **📊 Records & Resume**
  - **Best score per difficulty**, tracked separately for every board size.
  - Your in-progress game is saved as you play — close the tab and pick the run up later.

- **🎨 Material You & Polished Design**
  - **Dynamic theming**: eight accents (紫罗兰, 天空蓝, 青色, 翠绿, 琥珀黄, 暖橙, 玫粉, 珊瑚红) each generating a full Material token set with tinted gradients and elevated surfaces.
  - Day / Night mode with the initial choice taken from `prefers-color-scheme`, live `theme-color` updates, and `prefers-reduced-motion` support.

- **🔒 100% Privacy, Offline & Ad-Free**
  - **Zero network requests** — no assets are fetched, because there are none.
  - Preferences, records and the saved game live in `localStorage` (`yipop-*`); nothing is uploaded.
  - Licensed under **AGPL-3.0**.

- **♿ Built to Be Usable**
  - Arrow keys walk the board, `Z` undoes, `R` restarts, `Esc` closes overlays.
  - Labelled buttons and `aria-live` regions announce score and state changes.

<br>

## 🛠️ Why YiPop? (Under the Hood)

### 1. Scoring You Can Plan Around
Because a group of *n* stars is worth exactly **n² × 5**, the game is an exercise in deliberately merging colours before you pop them. The preview exists for the same reason: the interesting decision is not "can I click this", it is "should I wait two more moves".

### 2. BFS Explosions and Interruptible Animation
Removals are processed in breadth-first order from the clicked star, so the visual chain travels outward the way the eye expects. Every animation is tagged with an action token, so restarting or undoing mid-explosion cancels the in-flight sequence cleanly instead of corrupting the board.

### 3. Synthesised Audio, Zero Assets
Sound is generated with the Web Audio API — short tone bursts whose frequency and decay follow the size of the group. That keeps the whole game at a single file with no media downloads, and makes the audio switch in the menu instant. The same philosophy applies to type: the "Nebulove" typeface is embedded as a **~43 KB subset** produced by `scripts/subset_font.py` from the glyphs this page renders, so not even the font is fetched from the network.

<br>

## 🚀 Play It Now

There is nothing to install — the game *is* one HTML file.

### Option 1 — Just open it
Download `index.html` (or clone the repository) and double-click the file. It works straight from disk, offline.

### Option 2 — Serve it locally
```bash
git clone https://github.com/lingyicute/YiPop.git
cd YiPop
python3 -m http.server 8000     # then open http://localhost:8000
```

### Option 3 — Publish it anywhere
Drop `index.html` on GitHub Pages, Cloudflare Pages, Netlify or any static host — a single file is the entire deployment.

### Requirements
- **Browser**: any modern browser (Chrome, Edge, Firefox, Safari, or their mobile counterparts).
- **Network**: not required. Zero requests are made to any server.
- **Storage**: `localStorage` only, for preferences, records and the saved run.
- **Permissions**: none — sound plays only after you interact with the page.

<br>

## 🔨 Building from Source

There is no build step: `index.html` is the source *and* the artifact.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/lingyicute/YiPop.git
   cd YiPop
   ```

2. **Edit and reload** — the file is organised with banner comments and a small `CONFIGS` table at the top of the script that defines every difficulty (size, colours, target score), which is the quickest way to experiment.

3. **Refresh the embedded font (optional)** — after changing UI copy, re-subset the inlined "Nebulove" typeface so the new glyphs are included (the script keeps only the characters the page actually renders, and falls back to the remote font URL only if the data URI is unavailable):
   ```bash
   pip install fonttools brotli
   python3 scripts/subset_font.py --check    # report only
   python3 scripts/subset_font.py            # subset & embed in place
   ```

<br>

## 🤗 Contributing

Contributions are always welcome!
- **Bug Reports & Feature Requests**: submit an issue on the [GitHub Issue Tracker](https://github.com/lingyicute/YiPop/issues).
- **Pull Requests**: keep the single-file, zero-dependency philosophy intact and match the existing code style.
- **Translations**: the interface is currently Simplified Chinese — an i18n layer plus translated string tables would be very welcome.

<br>

## 📄 License

```text
Copyright (C) 2026 lingyicute <li@92li.uk>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
```
