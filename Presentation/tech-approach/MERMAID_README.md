# Technical Approach: Mermaid diagram

| File | Use it for |
|---|---|
| `tech_approach_SLIDE.mmd` | **The slide.** Tuned so the text lands at about 9–10 pt when the image fits the slide. |
| `tech_approach_FULL_detailed.mmd` | README, report or appendix. Has a description line on every box, but the text is only about 6 pt if squeezed onto one slide. |

## Exact size on the slide

The free area on the SIH template (under the title, above the blue footer):

| | inches | cm | pixels @ 300 DPI |
|---|---|---|---|
| **Width** | **12.53"** | 31.8 cm | **3760 px** |
| **Height** | **5.57"** | 14.1 cm | **1670 px** |
| **Position** | left 0.40", top 1.30" | left 1.0 cm, top 3.3 cm | |

The target aspect ratio is **2.25 : 1**. The slide diagram renders at about **2.4 : 1**, so at full width
(12.53") it is about **5.2" tall**. Nudge it down to top ≈ 1.45" to centre it in the free area.

## Render it

**Option A: no install.** Open https://mermaid.live, paste the file, then Actions → **SVG** (or PNG).
Insert the **SVG** into PowerPoint (Insert → Pictures). It stays vector and razor-sharp at any zoom.
Set Width = 12.53", lock the aspect ratio, and place it at left 0.40" / top 1.45".

**Option B: CLI**
```bash
npm i -g @mermaid-js/mermaid-cli
mmdc -i tech_approach_SLIDE.mmd -o tech_approach.svg -b white
mmdc -i tech_approach_SLIDE.mmd -o tech_approach.png -b white -s 2   # PNG, 2x scale ≈ 6500 px wide
```

## Spacing controls (in the `%%{init}%%` block at the top)

| Setting | Current | What it does |
|---|---|---|
| `rankSpacing` | 60 | gap between the columns (① → ② → ③ …); raise it to spread horizontally |
| `nodeSpacing` | 40 | gap between boxes inside a column; raise it for more vertical air |
| `padding` | 24 | inner padding of each box |
| `subGraphTitleMargin` | 14 / 28 | space above and below each coloured column title |
| `fontSize` | 38px | node text. Keep it ≥ 36px, or the text drops below 9 pt on the slide |
| `.tech` in `themeCSS` | 30px | the grey italic tech-stack labels |

Rule of thumb: every +10 on `rankSpacing` makes the image about 2% wider, which shrinks the text by about 2%
once fitted to the slide. Keep the rendered width/height ratio between **2.2 and 2.6** for the best fit.
