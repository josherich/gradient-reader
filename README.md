# gradient-reader

[demo](https://josherich.github.io/gradient-reader/)

Highlight interesting words

In **Semantic role** mode, the role map below the article groups consecutive sentences by role. Each colored segment represents a sentence; the same word count has the same width across rows. Hover to see its role and text. Drag the segment's right edge to set its target length. The number shows the original word count, or target/original when changed; stripes mark adjusted segments. Set a target to zero to remove its sentence. The rewrite button appears when a target changes. The rewritten article keeps unedited sentences in place and shows the same role colors in a second reading panel.

Generating rewritten sentences requires the local server (`npm start`) and `OPENROUTER_API_KEY`. The default rewrite model is `xiaomi/mimo-v2.6-pro`; set `OPENROUTER_REWRITE_MODEL` to choose another OpenRouter model. The static GitHub Pages demo can show the role map and remove sentences, but cannot generate rewrites.

## Updates
- 2026.09.23 update: compact binary frequency dictionaries (front-coded, log2-quantized, gzipped)
- 2025.03.23 add: render using language model
- 2020.01.21 fix: should skip quotes
- 2019.10.18 support: English

## TODOs

- ~~support English~~
- ~~highlight using language models~~
- highlight(toggle) name entities

![shot-en](./gradient-reader-en.png)
![shot-cn](./gradient-reader.png)
