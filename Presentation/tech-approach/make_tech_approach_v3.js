// Builds tech_approach_v3.html — the Technical Approach diagram (slide 3) for the SIH26106 deck.
// Canvas 1880x834 CSS px == the picture slot on slide 3 (12.97in x 5.75in). Icons come from dashboard/node_modules (lucide-react).
// Build:  node make_tech_approach_v3.js
// Render: chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1880,834
//           --virtual-time-budget=10000 --screenshot=tech_approach_v3.png file:///<abs path>/tech_approach_v3.html
// Then swap the PNG in as the picture on slide 3 (ppt/media/image50.png in the deck).
const fs = require('fs');
const path = require('path');
const NM = path.join(__dirname, '../../dashboard/node_modules/') + '/';
const React = require(NM + 'react');
const { renderToStaticMarkup } = require(NM + 'react-dom/server');
const L = require(NM + 'lucide-react');

const ic = (n, color, size = 22, sw = 2) =>
  renderToStaticMarkup(React.createElement(L[n], { size, color, strokeWidth: sw }));

const INK = '#1F2A44', MUTED = '#5A6378';
const P = {
  blue:  { bg: '#E8F1FC', bd: '#BCD5F2', st: '#1F5FB8', tint: '#DCE9FA' },
  amber: { bg: '#FFF5DE', bd: '#F1D594', st: '#D97F1E', tint: '#FDEBC4' },
  lav:   { bg: '#F0ECFC', bd: '#D3C9F5', st: '#5B4BC4', tint: '#E4DDFA' },
  mint:  { bg: '#E7F6EE', bd: '#BDE5CF', st: '#2E8B62', tint: '#D3EFE0' },
  sky:   { bg: '#E9F2FC', bd: '#BFD8F1', st: '#2B6CB0', tint: '#D7E7F8' },
};

const head = (n, title, pal, sub = '') => `
  <div class="ph"><div class="num" style="background:${pal.st}">${n}</div>
  <div class="pt">${title}</div>${sub ? `<div class="psub">${sub}</div>` : ''}</div>`;

const panel = (id, pal, x, y, w, h, inner) =>
  `<div class="panel" id="${id}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${pal.bg};border-color:${pal.bd}">${inner}</div>`;

const abs = (x, y, w, h) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
const bubble = (name, pal, size = 36, isz = 20) =>
  `<div class="bub" style="width:${size}px;height:${size}px;background:${pal.tint}">${ic(name, pal.st, isz)}</div>`;

// ── Entry-point illustrations ────────────────────────────────────────────
const svgBrowser = `<svg width="150" height="86" viewBox="0 0 150 86">
  <rect x="11" y="2" width="128" height="80" rx="9" fill="#fff" stroke="#3A4660" stroke-width="2.2"/>
  <path d="M11 11a9 9 0 0 1 9-9h110a9 9 0 0 1 9 9v8H11z" fill="#E4EAF3"/>
  <circle cx="21" cy="10.5" r="2.7" fill="#EF6A5A"/><circle cx="29.5" cy="10.5" r="2.7" fill="#F5BD4F"/><circle cx="38" cy="10.5" r="2.7" fill="#5BC467"/>
  <rect x="48" y="6.5" width="82" height="8" rx="4" fill="#fff"/>
  <g transform="translate(62 50)">
    <circle r="21" fill="#DB4437"/>
    <path d="M0 0 L18.19 -10.5 A21 21 0 0 1 0 21 Z" fill="#F4B400"/>
    <path d="M0 0 L0 21 A21 21 0 0 1 -18.19 -10.5 Z" fill="#0F9D58"/>
    <circle r="10" fill="#fff"/><circle r="7.6" fill="#4285F4"/>
  </g>
  <rect x="92" y="56" width="42" height="21" rx="6" fill="#1F5FB8"/>
  <text x="113" y="71" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">MV3</text>
</svg>`;

const svgGmail = `<svg width="150" height="86" viewBox="0 0 150 86">
  <rect x="26" y="6" width="84" height="64" rx="9" fill="#fff" stroke="#C9D2DF" stroke-width="2"/>
  <path d="M38 60 V22" stroke="#4285F4" stroke-width="9" stroke-linecap="round"/>
  <path d="M98 60 V22" stroke="#34A853" stroke-width="9" stroke-linecap="round"/>
  <path d="M38 22 L68 44 L98 22" stroke="#EA4335" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="98" cy="22" r="4.5" fill="#FBBC04"/>
  <g transform="translate(90 44)">
    <rect x="0" y="0" width="52" height="34" rx="9" fill="#2E8B62"/>
    <path d="M26 6 L36 10 V17 C36 23 31.5 27 26 29 C20.5 27 16 23 16 17 V10 Z" fill="#fff"/>
    <path d="M21.5 17.5 l3.3 3.3 l6 -6.3" stroke="#2E8B62" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const svgMonitor = `<svg width="150" height="86" viewBox="0 0 150 86">
  <rect x="17" y="2" width="116" height="66" rx="7" fill="#26324A"/>
  <rect x="22" y="7" width="106" height="56" rx="3" fill="#F4F7FB"/>
  <rect x="22" y="7" width="22" height="56" rx="3" fill="#DCE5F2"/>
  <rect x="26" y="13" width="14" height="3" rx="1.5" fill="#9FB0C8"/><rect x="26" y="20" width="14" height="3" rx="1.5" fill="#9FB0C8"/>
  <rect x="26" y="27" width="14" height="3" rx="1.5" fill="#1F5FB8"/><rect x="26" y="34" width="14" height="3" rx="1.5" fill="#9FB0C8"/>
  <rect x="50" y="13" width="34" height="6" rx="3" fill="#C0394B"/>
  <rect x="50" y="24" width="72" height="3" rx="1.5" fill="#C3CCD9"/><rect x="50" y="31" width="58" height="3" rx="1.5" fill="#C3CCD9"/>
  <g stroke="#7E95C8" stroke-width="1.4"><line x1="58" y1="50" x2="74" y2="42"/><line x1="74" y1="42" x2="90" y2="52"/><line x1="74" y1="42" x2="98" y2="40"/><line x1="98" y1="40" x2="114" y2="50"/></g>
  <circle cx="58" cy="50" r="3.6" fill="#5B4BC4"/><circle cx="74" cy="42" r="4.2" fill="#C0394B"/><circle cx="90" cy="52" r="3.6" fill="#5B4BC4"/><circle cx="98" cy="40" r="3.6" fill="#2B6CB0"/><circle cx="114" cy="50" r="3.6" fill="#2E8B62"/>
  <path d="M66 68h18l3 9H63z" fill="#3A4660"/><rect x="54" y="76" width="42" height="4.5" rx="2.2" fill="#3A4660"/>
  <rect x="98" y="58" width="48" height="21" rx="6" fill="#111"/>
  <text x="122" y="73" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">Next.js</text>
</svg>`;

const svgTerminal = `<svg width="150" height="86" viewBox="0 0 150 86">
  <rect x="17" y="3" width="116" height="74" rx="9" fill="#1F2A44"/>
  <circle cx="28" cy="13" r="2.7" fill="#EF6A5A"/><circle cx="36.5" cy="13" r="2.7" fill="#F5BD4F"/><circle cx="45" cy="13" r="2.7" fill="#5BC467"/>
  <path d="M31 35 l11 9 l-11 9" stroke="#7EE2A8" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="48" y="51" width="20" height="4" rx="2" fill="#E8EDF5"/>
  <rect x="88" y="56" width="56" height="21" rx="6" fill="#3776AB"/>
  <circle cx="98" cy="66.5" r="4" fill="#FFD43B"/>
  <text x="123" y="71.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="#fff">Python</text>
</svg>`;

const entry = (id, svg, t, s) => `
  <div class="entry" id="${id}">${svg}<div class="et">${t}</div><div class="es">${s}</div></div>`;

// ── Result mocks ─────────────────────────────────────────────────────────
const mockDash = `<svg width="164" height="132" viewBox="0 0 164 132">
  <rect width="164" height="132" rx="9" fill="#1B2436"/>
  <path d="M9 0h23v132H9a9 9 0 0 1-9-9V9a9 9 0 0 1 9-9z" fill="#131A28"/>
  ${[16, 26, 36, 46, 56].map((y, i) => `<rect x="7" y="${y}" width="18" height="3.4" rx="1.7" fill="${i === 2 ? '#6D8DF0' : '#3A4868'}"/>`).join('')}
  <rect x="40" y="10" width="34" height="9" rx="4.5" fill="#C0394B"/>
  <rect x="80" y="12" width="46" height="4" rx="2" fill="#44527A"/>
  <rect x="40" y="26" width="64" height="58" rx="5" fill="#222D45"/>
  <g stroke="#6D8DF0" stroke-width="1.3" opacity=".9"><line x1="50" y1="70" x2="62" y2="46"/><line x1="62" y1="46" x2="80" y2="58"/><line x1="62" y1="46" x2="86" y2="38"/><line x1="80" y1="58" x2="94" y2="72"/><line x1="50" y1="70" x2="80" y2="58"/></g>
  <circle cx="50" cy="70" r="3.4" fill="#9DB4FF"/><circle cx="62" cy="46" r="4.4" fill="#E0697A"/><circle cx="80" cy="58" r="3.6" fill="#9DB4FF"/><circle cx="86" cy="38" r="3.4" fill="#7EE2A8"/><circle cx="94" cy="72" r="3.4" fill="#9DB4FF"/>
  <rect x="110" y="26" width="46" height="58" rx="5" fill="#243251"/>
  <path d="M113 40q12-8 20 2t20-2M113 62q14-6 22 2t18 0" stroke="#3B4D78" stroke-width="1.4" fill="none"/>
  <path d="M133 44c-5.5 0-9 4-9 8.6 0 6 9 14.4 9 14.4s9-8.4 9-14.4c0-4.6-3.5-8.6-9-8.6z" fill="#E0697A"/><circle cx="133" cy="52.6" r="3.2" fill="#243251"/>
  <rect x="40" y="94" width="116" height="26" rx="6" fill="#2B6CB0"/>
  <text x="98" y="112" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">PDF report</text>
</svg>`;

const chip = (y, fill, tc, txt) => `
  <rect x="8" y="${y}" width="30" height="5" rx="2.5" fill="#5A6378"/>
  <rect x="8" y="${y + 11}" width="40" height="4" rx="2" fill="#C3CAD6"/>
  <rect x="54" y="${y - 3}" width="74" height="22" rx="11" fill="${fill}"/>
  <text x="91" y="${y + 12.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${tc}">${txt}</text>`;
const mockGmail = `<svg width="170" height="132" viewBox="0 0 170 132">
  <rect x="1" y="1" width="168" height="130" rx="9" fill="#fff" stroke="#C9D2DF" stroke-width="1.6"/>
  <path d="M10 1h150a9 9 0 0 1 9 9v12H1V10a9 9 0 0 1 9-9z" fill="#F1F4F9"/>
  <path d="M9 17V7l6 4.5L21 7v10" stroke="#EA4335" stroke-width="2.4" fill="none" stroke-linejoin="round"/>
  <rect x="28" y="7" width="100" height="9" rx="4.5" fill="#fff"/>
  <line x1="138" y1="22" x2="138" y2="131" stroke="#E1E6EE" stroke-width="1.4"/>
  ${chip(34, '#D93025', '#fff', 'Dangerous')}
  ${chip(68, '#F2A600', '#3D2D00', 'Suspicious')}
  ${chip(102, '#188038', '#fff', 'Safe')}
  <rect x="143" y="30" width="20" height="20" rx="6" fill="#E6F6EE"/>
  <path d="M153 34 L158.5 36.2 V40 C158.5 43.3 156 45.6 153 46.6 C150 45.6 147.5 43.3 147.5 40 V36.2 Z" fill="#2E8B62"/>
  <rect x="143" y="58" width="20" height="4" rx="2" fill="#D5DBE5"/><rect x="143" y="67" width="20" height="4" rx="2" fill="#D5DBE5"/>
  <rect x="142" y="80" width="22" height="12" rx="4" fill="#2B6CB0"/>
</svg>`;

const mockExt = `<svg width="150" height="132" viewBox="0 0 150 132">
  <rect x="1" y="1" width="148" height="130" rx="9" fill="#fff" stroke="#C9D2DF" stroke-width="1.6"/>
  <path d="M10 1h130a9 9 0 0 1 9 9v12H1V10a9 9 0 0 1 9-9z" fill="#F1F4F9"/>
  <circle cx="11" cy="11.5" r="2.6" fill="#EF6A5A"/><circle cx="19" cy="11.5" r="2.6" fill="#F5BD4F"/><circle cx="27" cy="11.5" r="2.6" fill="#5BC467"/>
  <rect x="36" y="7" width="104" height="9" rx="4.5" fill="#fff"/>
  <rect x="10" y="30" width="130" height="92" rx="8" fill="#FCE8EA" stroke="#E7A3AC" stroke-width="1.4"/>
  <path d="M75 38 L87 60 H63 Z" fill="#C0394B" stroke="#C0394B" stroke-width="3" stroke-linejoin="round"/>
  <rect x="73.8" y="45" width="2.6" height="8" rx="1.3" fill="#fff"/><circle cx="75.1" cy="56.5" r="1.6" fill="#fff"/>
  <text x="75" y="80" text-anchor="middle" font-size="13" font-weight="700" fill="#A02C3C">Dangerous site</text>
  <rect x="26" y="90" width="98" height="22" rx="6" fill="#C0394B"/>
  <text x="75" y="105.5" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">Report &amp; block</text>
</svg>`;

// ── Panels ───────────────────────────────────────────────────────────────
const G = { p1: [0, 0, 300, 834], p2: [336, 0, 542, 486], p3: [914, 0, 966, 486], p4: [336, 520, 742, 314], p5: [1114, 520, 766, 314] };

const p1 = panel('p1', P.blue, ...G.p1, `
  ${head(1, 'Entry points', P.blue)}
  <div class="p1list">
    ${entry('e1', svgBrowser, 'Chrome MV3 extension', 'every page visit · auto-check of<br>each Gmail message opened')}
    ${entry('e2', svgGmail, 'Gmail Add-on', 'Apps Script auto-scanner labels<br>the inbox · sidebar report card')}
    ${entry('e3', svgMonitor, 'Analyst dashboard', '.eml upload · case pages ·<br>campaigns · PDF report')}
    ${entry('e4', svgTerminal, 'Python CLI', 'URL &amp; raw-email checks<br>from the terminal')}
  </div>`);

const trig = (id, x, y, w, h, icon, t, s) => `
  <div class="card trig" id="${id}" style="${abs(x, y, w, h)};border-color:${P.amber.bd}">
    ${bubble(icon, P.amber, 34, 19)}<div><div class="ct">${t}</div><div class="cs">${s}</div></div></div>`;
const mrow = (icon, t, s, pal) => `
  <div class="mrow">${bubble(icon, pal, 32, 18)}<div><div class="ct">${t}</div><div class="cs">${s}</div></div></div>`;

const p2 = panel('p2', P.amber, ...G.p2, `
  ${head(2, 'Fast triage', P.amber)}
  <div class="claim">${ic('ShieldCheck', '#fff', 17, 2.4)}<span>0 false alerts</span><em>in live Gmail tests</em></div>
  ${trig('t1', 16, 84, 206, 72, 'Globe', 'Every page visit', 'Chrome extension')}
  ${trig('t2', 16, 198, 206, 70, 'MailOpen', 'Gmail email opened', 'auto · once per email')}
  ${trig('t3', 16, 280, 206, 70, 'Inbox', 'New inbox mail', 'Apps Script · every min')}
  <div class="card mcard" id="m1" style="${abs(242, 64, 280, 112)};border-color:${P.amber.bd}">
    <div class="mh" style="color:${P.amber.st}">Link check <span>URLs &amp; email links</span></div>
    ${mrow('Cpu', 'ONNX URL model', 'local ML phishing score', P.amber)}
    ${mrow('ShieldCheck', 'VirusTotal corroboration', 'cached · can overrule the model', P.amber)}
  </div>
  <div class="card mcard" id="m2" style="${abs(242, 212, 280, 130)};border-color:${P.amber.st};border-width:2px">
    <div class="mh" style="color:${P.amber.st}">Text verdict <span>email body</span></div>
    <div class="jev"><div class="jbub">${ic('Sparkles', '#fff', 19)}</div>
      <div><div class="jt">Jev <span>primary classifier</span></div><div class="js">decides the text verdict</div></div></div>
    ${mrow('BrainCircuit', 'BERT phishing model', 'local backup if Jev is offline', P.amber)}
  </div>
  <div class="lbl" id="lb_ctx" style="left:296px;top:185px">link verdict → context for Jev</div>
  <div class="card tl" id="tl" style="${abs(16, 372, 280, 96)};border-color:${P.amber.bd}">
    <div class="tlbox"><i style="background:radial-gradient(circle at 35% 30%,#9BF0A8,#22A447 60%,#127A30)"></i><i style="background:radial-gradient(circle at 35% 30%,#FFE69A,#F2A600 60%,#C27F00)"></i><i style="background:radial-gradient(circle at 35% 30%,#FFA8A0,#E3342F 60%,#A81E1B)"></i></div>
    <div class="tll"><span>Safe</span><span>Suspicious</span><span>Dangerous</span></div>
  </div>
  <div class="lbl" style="left:284px;top:347px">combined verdict</div>
  <div class="card out" id="o1" style="${abs(318, 372, 204, 44)};border-color:${P.amber.bd}">${ic('BellRing', P.amber.st, 18)}<span>Banner · Gmail label</span></div>
  <div class="card out strong" id="o2" style="${abs(318, 424, 204, 44)};border-color:${P.amber.st}">${ic('ScanSearch', P.amber.st, 18)}<span>Full scan on demand</span></div>
`);

const rcard = (id, x, w, icon, t, s) => `
  <div class="card rc" id="${id}" style="${abs(x, 66, w, 78)};border-color:${P.lav.bd}">
    <div class="rch">${ic(icon, P.lav.st, 19)}<div class="ct">${t}</div></div><div class="cs">${s}</div></div>`;
const bl = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const tool = (icon, t, s, wide = false) => `
  <div class="tool${wide ? ' wide' : ''}">${bubble(icon, P.lav, 31, 17)}<div><div class="ct">${t}</div><div class="cs">${s}</div></div></div>`;

const p3 = panel('p3', P.lav, ...G.p3, `
  ${head(3, 'Full investigation', P.lav, 'LangGraph agent · live progress over SSE')}
  ${rcard('r1', 16, 132, 'Server', 'FastAPI', 'SSE live progress')}
  ${rcard('r2', 162, 132, 'Workflow', 'LangGraph', 'stateful workflow')}
  ${rcard('r3', 308, 132, 'Database', 'Link cache', 'blocklist · 24 h')}
  ${rcard('r4', 454, 132, 'Split', 'Raw email?', 'headers present?')}
  <div class="fwrap" id="fw" style="${abs(16, 164, 570, 190)}">
    <div class="fwh"><b style="color:${P.lav.st}">YES → deterministic forensics</b><span>no headers → straight to the agent</span></div>
    <div class="card fc" id="f1" style="${abs(10, 30, 270, 148)};border-color:${P.lav.bd}">
      <div class="fch">${bubble('MailSearch', P.lav, 30, 17)}<div class="ct">Header &amp; auth forensics</div></div>
      ${bl(['Received hops → hop-0 origin', 'SPF · DKIM · DMARC + alignment', 'Sender-domain age · WHOIS', 'Origin IP · TOR / VPN / hosting'])}
    </div>
    <div class="card fc" id="f2" style="${abs(290, 30, 270, 148)};border-color:${P.lav.st}">
      <div class="fch">${bubble('FileLock2', P.lav, 30, 17)}<div class="ct">Attachment &amp; PDF sandbox</div></div>
      ${bl(['Hash · real type · macros · ClamAV', 'PDF text → phishing classifier', 'PDF links → ML + VirusTotal', 'Embedded JS · auto-launch · files'])}
      <div class="fcf">never opened, rendered or executed</div>
    </div>
  </div>
  <div class="agent" id="ag" style="${abs(16, 376, 570, 94)}">
    <div class="agi">${ic('Bot', '#fff', 30)}</div>
    <div><div class="agt">LLM AGENT <span>via OpenRouter</span></div>
    <div class="ags">Reasons over all evidence, picks the next tool, loops until confident.<br>Outage or limit → fails safe to “suspicious”, never “legitimate”.</div></div>
  </div>
  <div class="card tools" id="tb" style="${abs(606, 66, 340, 404)};border-color:${P.lav.bd}">
    <div class="tbh"><span class="ct">Investigation tools</span><span class="cs">called by the agent</span></div>
    <div class="tgrid">
      ${tool('ScanSearch', 'Sandboxed browser', 'headless Chromium')}
      ${tool('Search', 'Brand search', 'DuckDuckGo')}
      ${tool('ShieldCheck', 'WHOIS + VirusTotal', 'domain reputation')}
      ${tool('BrainCircuit', 'ONNX + BERT', 'URL &amp; text models')}
      ${tool('MapPin', 'IP geolocation', 'GeoLite2 · TOR / VPN')}
      ${tool('Waypoints', 'Entity correlation', 'NetworkX graph')}
      ${tool('Brain', 'SecureBERT case recall', 'similar past investigations', true)}
    </div>
  </div>
`);

const ecard = (id, x, y, w, h, icon, t, s, pal) => `
  <div class="card ec" id="${id}" style="${abs(x, y, w, h)};border-color:${pal.bd}">
    ${bubble(icon, pal, 44, 24)}<div class="ct">${t}</div><div class="cs">${s}</div></div>`;

const p4 = panel('p4', P.mint, ...G.p4, `
  ${head(4, 'Evidence, privacy &amp; case memory', P.mint)}
  ${ecard('c1a', 16, 64, 184, 112, 'Database', 'SQLite case history', 'raw headers kept as evidence', P.mint)}
  ${ecard('c1b', 16, 186, 184, 112, 'EyeOff', 'PII masking', 'Microsoft Presidio', P.mint)}
  ${ecard('c2', 226, 116, 164, 130, 'BrainCircuit', 'SecureBERT embeddings', 'case memory', P.mint)}
  ${ecard('c3a', 416, 64, 172, 112, 'Network', 'NetworkX entity graph', 'sender · domain · IP', P.mint)}
  ${ecard('c3b', 416, 186, 172, 112, 'Boxes', 'DBSCAN campaigns', 'related frauds clustered', P.mint)}
  ${ecard('c4', 614, 116, 110, 130, 'Timer', '90-day retention', 'auto-delete', P.mint)}
`);

const pill = (t, bg, fg, bd) => `<span class="pill" style="background:${bg};color:${fg};border-color:${bd}">${t}</span>`;
const mock = (id, x, w, svg, t, s) => `
  <div class="card mk" id="${id}" style="${abs(x, 62, w, 234)};border-color:${P.sky.bd}">
    ${svg}<div class="ct">${t}</div><div class="cs">${s}</div></div>`;

const p5 = panel('p5', P.sky, ...G.p5, `
  ${head(5, 'Analyst-facing result', P.sky)}
  <div class="card vc" id="vc" style="${abs(16, 62, 188, 234)};border-color:${P.sky.bd}">
    <div class="fch">${bubble('BadgeCheck', P.sky, 30, 17)}<div class="ct">Explainable verdict</div></div>
    <div class="pills">
      ${pill('legitimate', '#E6F6EE', '#2E8B62', '#BDE5CF')}${pill('suspicious', '#FFF6DA', '#9A7300', '#F1DE9C')}
      ${pill('impersonated', '#FDEEE4', '#C8612A', '#F4CDB3')}${pill('phishing', '#C0394B', '#fff', '#C0394B')}
      ${pill('fraud-related', '#EEEBFC', '#5B4BC4', '#CFC8F5')}
    </div>
    <div class="vcs">0–100 risk score, a written reason for every point, and attribution</div>
  </div>
  ${mock('mk1', 214, 178, mockDash, 'Dashboard', 'case page · map · graph')}
  ${mock('mk2', 402, 184, mockGmail, 'Gmail', 'colored labels + sidebar card')}
  ${mock('mk3', 596, 150, mockExt, 'Extension', 'warn · report · block')}
`);

const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1880px;height:834px;background:#fff;overflow:hidden}
body{font-family:'IBM Plex Sans','Segoe UI',sans-serif;color:${INK};position:relative;-webkit-font-smoothing:antialiased}
.panel{position:absolute;border:2px solid;border-radius:20px}
.panel>.ph{position:absolute;left:16px;top:12px;right:16px;display:flex;align-items:center;gap:11px;height:42px}
.num{width:40px;height:40px;border-radius:50%;color:#fff;font-weight:700;font-size:22px;display:flex;align-items:center;justify-content:center;flex:none}
.pt{font-size:26px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;white-space:nowrap}
.psub{font-size:14.5px;color:${MUTED};font-style:italic;margin-left:auto;white-space:nowrap}
.card{position:absolute;background:#fff;border:1.6px solid;border-radius:13px}
.bub{border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.ct{font-size:15px;font-weight:700;line-height:1.2}
.cs{font-size:12.8px;color:${MUTED};line-height:1.25}
.lbl{position:absolute;font-size:12.5px;font-style:italic;color:${MUTED};white-space:nowrap}
/* P1 */
.p1list{position:absolute;left:14px;right:14px;top:66px;bottom:14px;display:flex;flex-direction:column;gap:10px}
.entry{flex:1;background:#fff;border:1.6px solid ${P.blue.bd};border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:4px 8px}
.entry .et{font-size:17px;font-weight:700;margin-top:4px}
.entry .es{font-size:13px;color:${MUTED};line-height:1.28;margin-top:2px}
/* P2 */
.trig{display:flex;align-items:center;gap:10px;padding:0 10px}
.trig .ct{font-size:14.5px}
.mcard{padding:9px 12px;display:flex;flex-direction:column;gap:7px}
.jev{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#D46F12,#E89A2C);border-radius:10px;padding:6px 10px;color:#fff;box-shadow:0 2px 6px rgba(212,111,18,.28)}
.jbub{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;flex:none}
.jt{font-size:17px;font-weight:700;line-height:1.15}
.jt span{font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:#fff;color:#C4610A;border-radius:8px;padding:1px 7px;margin-left:7px;vertical-align:2px}
.js{font-size:12.5px;opacity:.96;line-height:1.25}
.claim{position:absolute;right:16px;top:19px;display:flex;align-items:center;gap:7px;background:#2E8B62;color:#fff;border-radius:18px;padding:5px 13px 5px 10px;box-shadow:0 2px 6px rgba(46,139,98,.3)}
.claim span{font-size:14.5px;font-weight:700}
.claim em{font-size:12.5px;font-weight:500;opacity:.92}
.mh{font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px}
.mh span{font-weight:500;text-transform:none;letter-spacing:0;color:${MUTED};font-style:italic;margin-left:6px}
.mrow{display:flex;align-items:center;gap:10px}
.mrow .ct{font-size:14.5px}
.tl{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.tlbox{background:#1F2A44;border-radius:30px;padding:7px 18px;display:flex;gap:44px}
.tlbox i{display:block;width:34px;height:34px;border-radius:50%;box-shadow:0 0 10px rgba(255,255,255,.18)}
.tll{display:flex;gap:18px;font-size:13.5px;font-weight:600}
.tll span{width:78px;text-align:center}
.out{display:flex;align-items:center;gap:8px;padding:0 10px;font-size:13.5px;font-weight:600}
.out.strong{border-width:2px;background:#FFFBF1;font-weight:700}
/* P3 */
.rc{padding:9px 10px;display:flex;flex-direction:column;justify-content:center;gap:4px}
.rch{display:flex;align-items:center;gap:6px;white-space:nowrap}
.rc .cs{font-size:12.5px}
.fwrap{position:absolute;border:1.6px dashed #B6A9EE;border-radius:14px;background:rgba(255,255,255,.45)}
.fwh{position:absolute;left:12px;right:12px;top:7px;display:flex;justify-content:space-between;font-size:12.5px;letter-spacing:.2px}
.fwh span{color:${MUTED};font-style:italic}
.fc{padding:9px 12px}
.fch{display:flex;align-items:center;gap:9px;margin-bottom:5px}
.fc ul{list-style:none;font-size:13.3px;line-height:1.45;color:#2A3550}
.fc li{position:relative;padding-left:13px}
.fc li:before{content:'';position:absolute;left:1px;top:8px;width:5px;height:5px;border-radius:50%;background:${P.lav.st}}
.fcf{position:absolute;left:25px;bottom:8px;font-size:12px;font-style:italic;color:${P.lav.st};font-weight:600}
.agent{position:absolute;background:${P.lav.st};border-radius:14px;display:flex;align-items:center;gap:14px;padding:0 18px;color:#fff}
.agi{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;flex:none}
.agt{font-size:19px;font-weight:700;letter-spacing:.4px}
.agt span{font-size:13px;font-weight:500;letter-spacing:0;opacity:.85;margin-left:6px}
.ags{font-size:13px;line-height:1.35;opacity:.95;margin-top:2px}
.tools{padding:12px 12px}
.tbh{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 10px}
.tbh .ct{font-size:16px}
.tgrid{display:flex;flex-direction:column;gap:6px}
.tool{background:${P.lav.bg};border-radius:11px;padding:0 10px;display:flex;align-items:center;gap:11px;height:43px}
.tool .ct{line-height:1.15}
.tool .ct{font-size:14px}
.tool .cs{font-size:12.8px}
.tool.wide{}
/* P4 */
.ec{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;padding:6px 8px}
.ec .ct{font-size:14.5px;margin-top:2px}
/* P5 */
.vc{padding:11px 12px}
.pills{display:flex;flex-wrap:wrap;gap:6px 5px;margin:9px 0 11px}
.pill{font-size:12.2px;font-weight:700;border:1.4px solid;border-radius:12px;padding:1px 7px}
.vcs{font-size:12.8px;color:${MUTED};line-height:1.32}
.mk{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:12px;text-align:center}
.mk .ct{margin-top:9px}
svg.wires{position:absolute;left:0;top:0;width:1880px;height:834px;overflow:visible;z-index:5;pointer-events:none}
.wl{position:absolute;z-index:6;font-size:12.5px;font-style:italic;color:${MUTED};white-space:nowrap;background:#fff;padding:0 5px;border-radius:4px}
`;

const js = `
const NS='http://www.w3.org/2000/svg';
function R(id){const r=document.getElementById(id).getBoundingClientRect();return{l:r.left,t:r.top,r:r.right,b:r.bottom,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2};}
function draw(){
  const svg=document.querySelector('svg.wires');
  const C='#8391A7';
  const line=(pts,o={})=>{const p=document.createElementNS(NS,'path');
    p.setAttribute('d',pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' '));
    p.setAttribute('fill','none');p.setAttribute('stroke',o.c||C);p.setAttribute('stroke-width',o.w||2.2);
    p.setAttribute('stroke-linejoin','round');p.setAttribute('stroke-linecap','round');
    if(o.dash)p.setAttribute('stroke-dasharray',o.dash);
    if(!o.noHead)p.setAttribute('marker-end','url(#ah)');
    if(o.start)p.setAttribute('marker-start','url(#ahs)');
    svg.appendChild(p);};
  const dot=(x,y)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r',3.6);c.setAttribute('fill',C);svg.appendChild(c);};
  const lab=(x,y,t,al)=>{const d=document.createElement('div');d.className='wl';d.textContent=t;document.body.appendChild(d);
    const w=d.offsetWidth,h=d.offsetHeight;d.style.left=(al==='l'?x:al==='r'?x-w:x-w/2)+'px';d.style.top=(y-h/2)+'px';};
  const p1=R('p1'),p2=R('p2'),p3=R('p3'),p4=R('p4'),p5=R('p5');
  const e=['e1','e2','e3','e4'].map(R), t=['t1','t2','t3'].map(R);
  const bx=(p1.r+p2.l)/2, gy=(p2.b+p4.t)/2, gx=(p2.r+p3.l)/2;
  // entry points -> bus -> triage triggers / full scan
  e.forEach(q=>{line([[q.r,q.cy],[bx,q.cy]],{noHead:true});});
  line([[bx,t[0].cy],[bx,e[3].cy]],{noHead:true});
  e.forEach(q=>dot(bx,q.cy));
  t.forEach(q=>line([[bx,q.cy],[q.l,q.cy]]));
  const r1=R('r1');
  line([[bx,gy],[gx,gy],[gx,r1.cy],[r1.l,r1.cy]]);
  dot(bx,gy);
  lab((bx+gx)/2+10,gy,'full scans: dashboard · CLI · extension · Gmail “Check Report”');
  // P2 internals
  const m1=R('m1'),m2=R('m2'),tl=R('tl'),o1=R('o1'),o2=R('o2');
  line([[t[0].r,t[0].cy],[m1.l,t[0].cy]]);
  const mx=(t[1].r+m2.l)/2;
  line([[t[1].r,t[1].cy],[mx,t[1].cy],[mx,t[2].cy],[t[2].r,t[2].cy]],{noHead:true});
  line([[mx,m2.cy],[m2.l,m2.cy]]);
  line([[m1.l+40,m1.b],[m1.l+40,m2.t]]);
  line([[m2.l+30,m2.b],[m2.l+30,tl.t]]);
  const ox=(tl.r+o1.l)/2;
  line([[tl.r,tl.cy],[ox,tl.cy]],{noHead:true});
  line([[ox,o1.cy],[ox,o2.cy]],{noHead:true});
  line([[ox,o1.cy],[o1.l,o1.cy]]);line([[ox,o2.cy],[o2.l,o2.cy]]);
  line([[o2.r,o2.cy],[gx,o2.cy]],{noHead:true});
  dot(gx,o2.cy);
  // P3 internals
  const r=['r1','r2','r3','r4'].map(R), fw=R('fw'), ag=R('ag'), tb=R('tb');
  for(let i=0;i<3;i++) line([[r[i].r,r[i].cy],[r[i+1].l,r[i].cy]]);
  line([[r[3].cx,r[3].b],[r[3].cx,fw.t]]);
  line([[ag.cx-120,fw.b],[ag.cx-120,ag.t]]);
  line([[ag.r,ag.cy-16],[tb.l,ag.cy-16]]);
  line([[tb.l,ag.cy+16],[ag.r,ag.cy+16]]);
  // across panels
  const x34=p3.l+86;
  line([[x34,p3.b],[x34,p4.t]]);
  lab(x34+8,(p3.b+p4.t)/2,'every run saved','l');
  const x35=p5.l+470;
  line([[x35,p3.b],[x35,p5.t]]);
  lab(x35+8,(p3.b+p5.t)/2,'verdict + evidence','l');
  line([[p4.r,p4.cy],[p5.l,p4.cy]]);
  // P4 internals
  const c=Object.fromEntries(['c1a','c1b','c2','c3a','c3b','c4'].map(k=>[k,R(k)]));
  const conv=(a,b,to)=>{const x=(a.r+to.l)/2;line([[a.r,a.cy],[x,a.cy],[x,b.cy],[b.r,b.cy]],{noHead:true});line([[x,to.cy],[to.l,to.cy]]);};
  const div=(from,a,b)=>{const x=(from.r+a.l)/2;line([[from.r,from.cy],[x,from.cy]],{noHead:true});line([[x,a.cy],[x,b.cy]],{noHead:true});line([[x,a.cy],[a.l,a.cy]]);line([[x,b.cy],[b.l,b.cy]]);};
  conv(c.c1a,c.c1b,c.c2); div(c.c2,c.c3a,c.c3b); conv(c.c3a,c.c3b,c.c4);
  document.body.setAttribute('data-ready','1');
}
document.fonts.ready.then(()=>requestAnimationFrame(draw));
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Technical Approach v3</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=block" rel="stylesheet">
<style>${css}</style></head><body>
<svg class="wires"><defs>
<marker id="ah" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="4.4" markerHeight="4.4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8391A7"/></marker>
<marker id="ahs" viewBox="0 0 10 10" refX="1.4" refY="5" markerWidth="4.4" markerHeight="4.4" orient="auto"><path d="M10 0L0 5L10 10z" fill="#8391A7"/></marker>
</defs></svg>
${p1}${p2}${p3}${p4}${p5}
<script>${js}</script></body></html>`;

const out = process.argv[2] || path.join(__dirname, 'tech_approach_v3.html');
fs.writeFileSync(out, html);
console.log('wrote', out, html.length);
