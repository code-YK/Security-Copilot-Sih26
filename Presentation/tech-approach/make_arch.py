"""Generates tech_architecture.html — the Technical Approach diagram for the SIH26106 deck.
Self-contained (icons inlined as base64). Render with render.py (Playwright) to a PNG.
Canvas 1880x836 CSS px == the slide content area (12.53in x 5.57in)."""
import base64, pathlib

IC = pathlib.Path("/home/claude/build/icons")
def ic(name, color):
    b = base64.b64encode((IC / f"{name}_{color}.png").read_bytes()).decode()
    return f'<img class="ic" src="data:image/png;base64,{b}">'

C = {  # fill, border, strong
    "sky": ("#E6F1FB", "#BFD8F1", "#2B6CB0"), "butter": ("#FFF6DA", "#F1DE9C", "#9A7300"),
    "rose": ("#FCE8EA", "#F2C1C7", "#C0394B"), "lav": ("#EEEBFC", "#CFC8F5", "#5B4BC4"),
    "mint": ("#E6F6EE", "#BDE5CF", "#2E8B62"), "slate": ("#F3F5F9", "#DCE1EA", "#1F2A44"),
}
def hexs(pal): return C[pal][2].lstrip("#")

def card(pal, icon, name, desc, tag, h=None):
    f, l, s = C[pal]
    return f'''<div class="card" style="border-color:{l};{f'height:{h}px' if h else ''}">
      <div class="row">{ic(icon, hexs(pal))}<div class="nm">{name}</div></div>
      <div class="ds">{desc}</div><div class="tag" style="color:{s};background:{f}">{tag}</div></div>'''

cols = [
    ("sky", 0, 290, "1", "Capture", "Three ways in", "".join([
        card("sky", "chrome", "Browser extension", "Scans every page & open webmail; blocks bad sites", "Chrome MV3 · React"),
        card("sky", "dash", "Analyst dashboard", "Upload an .eml, run scans, review cases", "Next.js 16 · React 19"),
        card("sky", "term", "REST API", "Plug into mail gateways & SOC tools", "FastAPI · live SSE stream"),
    ])),
    ("butter", 335, 270, "2", "Triage", "Instant first read", "".join([
        card("butter", "db", "Router", "Known-bad blocklist + 24-hour verdict cache", "SQLite"),
        card("butter", "zap", "Quick check", "Local ML scores the URL & text — no LLM call", "ONNX Runtime · BERT"),
        '<div class="note">Every page &amp; email gets this instant read. Only unclear cases go deeper →</div>',
    ])),
]

forensic = [("Header trace", "Mail-server hops → first sender (hop-0)", "Python email"),
            ("Sender check", "SPF · DKIM · DMARC + alignment", "checkdmarc"),
            ("Domain intel", "Domain age, MX & TXT records", "WHOIS · dnspython"),
            ("Origin IP", "City, ISP, ASN · TOR / VPN / hosting", "GeoLite2"),
            ("Attachments", "Hash, real type, macros — never opened", "oletools")]
f_html = "".join(f'''<div class="fr"><div class="n">{i+1}</div><div class="fx"><div class="nm2">{a}<span class="tg2">{t}</span></div>
  <div class="ds2">{b}</div></div></div>''' for i, (a, b, t) in enumerate(forensic))

tools = [("scan", "Sandbox browser", "Playwright · Chromium"), ("globe", "Reputation", "WHOIS · VirusTotal"),
         ("brain", "Phishing model", "BERT · ONNX"), ("search", "Brand search", "DuckDuckGo"),
         ("graph", "Case memory", "SecureBERT"), ("pin", "IP geolocation", "GeoLite2"),
         ("network", "Correlation", "NetworkX"), ("layers", "…and forensics", "results from ③")]
t_html = "".join(f'''<div class="tool">{ic(i, "5B4BC4")}<div><div class="tn">{a}</div><div class="tt">{b}</div></div></div>''' for i, a, b in tools)

outs = [("siren", "Alert & block", "extension banner"), ("pin", "Origin map + trace", "Leaflet"),
        ("graph", "Campaign graph", "NetworkX · DBSCAN"), ("report", "Forensic PDF report", "jsPDF")]
o_html = "".join(f'''<div class="out">{ic(i, "2E8B62")}<div><div class="tn">{a}</div><div class="tt">{b}</div></div></div>''' for i, a, b in outs)

stack = [("AI / ML", "lav", ["LangGraph", "LLM via OpenRouter", "Transformers", "ONNX Runtime", "SecureBERT", "scikit-learn"]),
         ("Forensics & intel", "rose", ["checkdmarc", "dkimpy", "dnspython", "GeoLite2", "Tor exit list", "AbuseIPDB", "VirusTotal", "oletools"]),
         ("Backend", "sky", ["Python 3.11", "FastAPI", "Playwright", "NetworkX", "SQLite", "Presidio"]),
         ("Frontend", "mint", ["Next.js 16", "React 19", "Tailwind", "Leaflet", "force-graph", "Chrome MV3"])]
s_html = "".join(f'''<div class="sg"><div class="sl" style="color:{C[p][2]}">{n}</div><div class="chips">{"".join(f'<span class="chip" style="border-color:{C[p][1]};background:{C[p][0]}">{c}</span>' for c in cs)}</div></div>''' for n, p, cs in stack)

def col(pal, x, w, n, title, sub, inner, extra_cls=""):
    f, l, s = C[pal]
    return f'''<div class="head" style="left:{x}px;width:{w}px"><span class="num" style="background:{s}">{n}</span><span style="color:{s}">{title}</span></div>
<div class="col {extra_cls}" style="left:{x}px;width:{w}px;background:{f};border-color:{l}"><div class="sub">{sub}</div>{inner}</div>'''

agent_html = f'''<div class="agent">{ic("bot","FFFFFF")}<div><div class="t1">LangGraph agent</div><div class="t2">LLM reasons over evidence · loops until confident</div></div></div>
<div class="loop"><span>↓ calls a tool</span><span>↑ reads the result</span></div><div class="tools">{t_html}</div>'''
verdict_html = f'''<div class="rules"><div class="t1">Rule engine</div><div class="t2">Risk 0–100 · a written reason for every point</div>
<div class="bar"><i style="background:#BDE5CF"></i><i style="background:#F1DE9C"></i><i style="background:#F5CDB0"></i><i style="background:#F2A7B0"></i><i style="background:#fff"></i></div>
<div class="labels"><span>legitimate</span><span>suspicious</span><span>impersonated</span><span>phishing</span><span>fraud</span></div></div>{o_html}'''
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:1880px;height:836px;background:#fff;font-family:Calibri,Carlito,sans-serif;color:#1F2A44;position:relative;overflow:hidden}}
.head{{position:absolute;top:0;height:38px;display:flex;align-items:center;gap:10px;font-weight:700;font-size:23px;letter-spacing:.3px;text-transform:uppercase}}
.num{{width:30px;height:30px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:18px}}
.col{{position:absolute;top:48px;height:540px;border:2px solid;border-radius:18px;padding:14px 14px 0;display:flex;flex-direction:column;gap:12px}}
.sub{{font-size:21px;font-weight:700;color:#1F2A44}}
.ic{{width:30px;height:30px;flex:none}}
.card{{background:#fff;border:2px solid;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}}
.row{{display:flex;align-items:center;gap:10px}}
.nm{{font-size:22px;font-weight:700}}
.ds{{font-size:19px;color:#5A6378;line-height:1.2}}
.tag{{align-self:flex-start;font-size:17px;font-weight:700;padding:3px 10px;border-radius:20px}}
.fr{{background:#fff;border:2px solid #F2C1C7;border-radius:14px;padding:9px 12px;display:flex;gap:12px;align-items:center}}
.n{{width:30px;height:30px;border-radius:50%;background:#C0394B;color:#fff;font-weight:700;font-size:18px;display:flex;align-items:center;justify-content:center;flex:none}}
.nm2{{font-size:21px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px;white-space:nowrap}}
.tg2{{font-size:15.5px;color:#C0394B;background:#FCE8EA;border-radius:20px;padding:2px 9px;white-space:nowrap}}
.ds2{{font-size:18.5px;color:#5A6378}}
.fx{{flex:1}}
.agent{{background:#5B4BC4;color:#fff;border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:14px}}
.agent .t1{{font-size:23px;font-weight:700}} .agent .t2{{font-size:18px;color:#E7E3FF}}
.loop{{display:flex;justify-content:center;gap:34px;font-size:17px;font-weight:700;color:#5B4BC4;margin:-2px 0 -4px}}
.tools{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.tool,.out{{background:#fff;border:2px solid #CFC8F5;border-radius:12px;padding:8px 10px;display:flex;gap:9px;align-items:center}}
.out{{border-color:#BDE5CF}}
.tool .ic,.out .ic{{width:26px;height:26px}}
.tn{{font-size:19px;font-weight:700;line-height:1.1}} .tt{{font-size:16.5px;color:#5A6378}}
.rules{{background:#2E8B62;color:#fff;border-radius:14px;padding:12px 14px}}
.rules .t1{{font-size:22px;font-weight:700}} .rules .t2{{font-size:18px;color:#DDF3E7;margin-top:2px}}
.bar{{display:flex;gap:4px;margin-top:9px}} .bar i{{flex:1;height:9px;border-radius:5px}}
.labels{{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}} .labels span{{font-size:15px;font-weight:700;background:#fff;color:#2E8B62;border-radius:12px;padding:1px 8px}}
.arrow{{position:absolute;top:290px;width:0;height:0;border-top:20px solid transparent;border-bottom:20px solid transparent;border-left:26px solid #9AA3B5}}
.bypass{{position:absolute;left:470px;top:588px;width:1250px;height:34px;border:2.5px dashed #C9A93A;border-top:none;border-radius:0 0 16px 16px}}
.bypass-l{{position:absolute;left:900px;top:606px;background:#fff;padding:0 12px;font-size:18px;font-weight:700;color:#9A7300}}
.data{{position:absolute;left:0;top:646px;width:1880px;height:62px;border-radius:16px;background:#F3F5F9;border:2px solid #DCE1EA;display:flex;align-items:center;gap:14px;padding:0 18px}}
.data .h{{font-size:20px;font-weight:700;color:#1F2A44;margin-right:6px;display:flex;gap:10px;align-items:center}}
.pill{{font-size:18px;background:#fff;border:2px solid #DCE1EA;border-radius:24px;padding:5px 14px;display:flex;gap:8px;align-items:center}}
.pill b{{color:#5B4BC4}}
.stack{{position:absolute;left:0;top:722px;width:1880px;height:106px;display:grid;grid-template-columns:1fr 1.25fr 1fr 1fr;gap:16px}}
.sg{{border:2px solid #DCE1EA;border-radius:16px;padding:8px 14px}}
.sl{{font-size:19px;font-weight:700;margin-bottom:6px}}
.chips{{display:flex;flex-wrap:wrap;gap:6px}}
.note{{font-size:19px;font-style:italic;color:#9A7300;line-height:1.25;padding:4px 4px 0}}
.chip{{font-size:16.5px;border:1.5px solid;border-radius:14px;padding:2px 10px;color:#1F2A44}}
</style></head><body>
{col(*cols[0])}
{col(*cols[1])}
{col("rose", 650, 370, "3", "Forensics", "Always runs on the raw email", f_html)}
{col("lav", 1065, 450, "4", "AI investigation", "Agent picks the next check", agent_html)}
{col("mint", 1560, 320, "5", "Verdict & action", "Explainable output", verdict_html)}
<div class="arrow" style="left:300px"></div><div class="arrow" style="left:615px"></div><div class="arrow" style="left:1030px"></div><div class="arrow" style="left:1525px"></div>
<div class="bypass"></div><div class="bypass-l">known threat → instant verdict, no AI call needed</div>
<div class="data"><div class="h">{ic("lock","1F2A44")}Shared data &amp; privacy layer</div>
<div class="pill"><b>Case history</b> SQLite</div><div class="pill"><b>Case memory</b> SecureBERT embeddings</div>
<div class="pill"><b>PII masking</b> Microsoft Presidio</div><div class="pill"><b>Evidence</b> SHA-256 hashes · raw headers kept</div><div class="pill"><b>Retention</b> auto-delete after 90 days</div></div>
<div class="stack">{s_html}</div>
</body></html>'''
pathlib.Path("/home/claude/build/arch/tech_architecture.html").write_text(html)
print("ok")
