# Technical Approach diagram: image-generation prompt

Use this with an image model (ChatGPT / GPT-image, Gemini, Ideogram, or Midjourney v7 with `--ar 9:4`).
Paste it in one go. If the model misspells labels, ask it to "re-render with exactly this text".
The deck already uses a pixel-perfect version built from code (`tech_architecture.html`), so this prompt is
only for trying an alternative look.

---

**PROMPT**

Create a clean, spacious, flat-vector **software architecture diagram** for a cybersecurity product called
**"Security-Copilot"**, an AI-powered email threat detection, geolocation and forensic intelligence platform.
Landscape, **9:4 aspect ratio (2820 × 1254 px)**, pure **white background**, no 3D, no photos, no people,
no brand logos, no gradients. The style should look like a premium SaaS pitch deck: soft pastel rounded cards
(18 px corner radius) with 2 px borders slightly darker than their fill, a single deep-navy text colour (#1F2A44),
a muted grey for secondary text (#5A6378), and plenty of white space between blocks. Use one clean sans-serif font
throughout (Calibri / Inter style). All text must be sharp, correctly spelled and legible at slide size.
Use simple thin-line icons (Lucide style), one in each card.

**Layout: five vertical columns read left → right, joined by four grey right-pointing chevron arrows.
Each column has a numbered coloured circle + UPPERCASE heading above it.**

1. **① CAPTURE** (sky-blue column: fill #E6F1FB, border #BFD8F1, accent #2B6CB0). Subtitle "Three ways in".
   Three white cards stacked:
   - 🧩 **Browser extension**: "Scans every page & open webmail; blocks bad sites"; tag pill **"Chrome MV3 · React"**
   - 📊 **Analyst dashboard**: "Upload an .eml, run scans, review cases"; tag **"Next.js 16 · React 19"**
   - ⌨ **REST API**: "Plug into mail gateways & SOC tools"; tag **"FastAPI · live SSE stream"**

2. **② TRIAGE** (butter-yellow column: fill #FFF6DA, border #F1DE9C, accent #9A7300). Subtitle "Instant first read".
   - 🗄 **Router**: "Known-bad blocklist + 24-hour verdict cache"; tag **"SQLite"**
   - ⚡ **Quick check**: "Local ML scores the URL & text, no LLM call"; tag **"ONNX Runtime · BERT"**
   - Italic note: *"Every page & email gets this instant read. Only unclear cases go deeper →"*

3. **③ FORENSICS** (rose column: fill #FCE8EA, border #F2C1C7, accent #C0394B). Subtitle "Always runs on the raw email".
   Five white rows, each with a red numbered circle, a bold name, a small rose tag on the right, and one grey line:
   1. **Header trace** [Python email]: "Mail-server hops → first sender (hop-0)"
   2. **Sender check** [checkdmarc]: "SPF · DKIM · DMARC + alignment"
   3. **Domain intel** [WHOIS · dnspython]: "Domain age, MX & TXT records"
   4. **Origin IP** [GeoLite2]: "City, ISP, ASN · TOR / VPN / hosting"
   5. **Attachments** [oletools]: "Hash, real type, macros, never opened"

4. **④ AI INVESTIGATION** (lavender column: fill #EEEBFC, border #CFC8F5, accent #5B4BC4, the widest column).
   Subtitle "Agent picks the next check".
   - A solid purple (#5B4BC4) card with a white robot icon: **"LangGraph agent"**, subtext
     "LLM reasons over evidence · loops until confident".
   - Beneath it two small purple labels with arrows: "↓ calls a tool" and "↑ reads the result" (showing a loop).
   - A 2 × 4 grid of small white tool cards (icon + bold name + grey tech):
     Sandbox browser (Playwright · Chromium) · Reputation (WHOIS · VirusTotal) · Phishing model (BERT · ONNX) ·
     Brand search (DuckDuckGo) · Case memory (SecureBERT) · IP geolocation (GeoLite2) · Correlation (NetworkX) ·
     "…and forensics: results from ③".

5. **⑤ VERDICT & ACTION** (mint column: fill #E6F6EE, border #BDE5CF, accent #2E8B62). Subtitle "Explainable output".
   - A solid green card **"Rule engine"**: "Risk 0–100 · a written reason for every point", with a thin 5-segment
     risk bar (mint → yellow → peach → pink → white) and five small white label pills:
     legitimate · suspicious · impersonated · phishing · fraud.
   - Four white output cards: 🔔 **Alert & block** (extension banner) · 📍 **Origin map + trace** (Leaflet) ·
     🔗 **Campaign graph** (NetworkX · DBSCAN) · 📄 **Forensic PDF report** (jsPDF).

**Below the columns:**
- A dashed golden line running from the TRIAGE column along the bottom to the VERDICT column, labelled
  **"known threat → instant verdict, no AI call needed"** (a fast bypass path).
- A full-width light-grey rounded band with a lock icon: **"Shared data & privacy layer"**, containing white pills:
  "Case history · SQLite" | "Case memory · SecureBERT embeddings" | "PII masking · Microsoft Presidio" |
  "Evidence · SHA-256 hashes · raw headers kept" | "Retention · auto-delete after 90 days".
- A bottom row of four outlined boxes titled **Tech stack**, each with small rounded chips:
  - **AI / ML** (lavender chips): LangGraph, LLM via OpenRouter, Transformers, ONNX Runtime, SecureBERT, scikit-learn
  - **Forensics & intel** (rose chips): checkdmarc, dkimpy, dnspython, GeoLite2, Tor exit list, AbuseIPDB, VirusTotal, oletools
  - **Backend** (sky chips): Python 3.11, FastAPI, Playwright, NetworkX, SQLite, Presidio
  - **Frontend** (mint chips): Next.js 16, React 19, Tailwind, Leaflet, force-graph, Chrome MV3

Keep generous, even gutters (~40 px) between all columns and bands, align every card edge on a grid, and keep
text left-aligned inside cards. The final image should be readable from the back of a room and feel calm,
organised and premium: an investor-grade architecture slide.

**Negative prompt:** clutter, dark background, neon, glow, 3D isometric, stock photos, hackers in hoodies,
padlock clip-art, misspelled words, tiny unreadable text, overlapping arrows, drop-shadows everywhere.

---

## Web-app mockup (Feasibility slide), optional

For an even stronger slide 4, send me **real screenshots** from the running dashboard, in the light or dark theme
(1440 × 900 browser window, zoom 100%):
1. **Overview** page (sidebar visible)
2. An **email case** page scrolled to the map + trace path
3. **Campaigns** page with the connections graph

I will drop them into the same browser-window mockup. If you'd rather generate one:

> A realistic laptop screen mockup (MacBook-style, silver, front view, white background, soft shadow) showing a
> dark-navy cybersecurity SaaS web app named "Security-Copilot". Left sidebar with: Overview, Link scans, Email scans,
> Campaigns, History, Settings. Main panel: an investigation titled "Urgent: your account has been limited", a red
> "Critical" badge, a "phishing" badge, an orange "Campaign C-9b6bad01" badge, a large risk score "100 / 100",
> "Attribution: Spoofed domain", a small map of Europe with a red pin on Berlin labelled "TOR exit node", and a
> small network graph of linked domains. Clean, modern, legible UI text, 16:10.
