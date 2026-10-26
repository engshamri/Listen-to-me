// Builds tests/fixtures/lecture-enzymes.pdf, the sample lecture used by the study tests: English pages with a
// heading, prose, a list, a table, a formula and code; an Arabic page; and a scanned
// page (text drawn on a canvas, so it has no text layer).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { font-family: Georgia, serif; font-size: 14px; line-height: 1.5; margin: 48px; }
h1 { font-size: 26px; } h2 { font-size: 20px; }
table { border-collapse: collapse; } td, th { padding: 4px 18px; border: 1px solid #999; }
pre { font-family: "Courier New", monospace; background: #f4f4f4; padding: 8px; }
.page { page-break-after: always; }
.ar { direction: rtl; font-family: Arial, sans-serif; }
</style></head><body>
<div class="page">
<h1>Lecture 3: Enzymes and Metabolism</h1>
<p>Enzymes are biological catalysts that speed up chemical reactions in living cells without being consumed. Most enzymes are proteins, and each one has an active site that binds a specific substrate.</p>
<p>The rate of an enzyme-catalysed reaction depends on temperature, pH, and the concentration of the substrate. Above the optimum temperature, the enzyme denatures and loses its shape.</p>
<h2>Key properties</h2>
<ul><li>Enzymes lower the activation energy of a reaction.</li><li>They are specific to their substrate.</li><li>They can be inhibited by competitive and non-competitive inhibitors.</li></ul>
</div>
<div class="page">
<h2>Michaelis–Menten kinetics</h2>
<p>The Michaelis–Menten equation describes how the reaction velocity depends on substrate concentration:</p>
<p style="text-align:center">v = Vmax × [S] / (Km + [S])</p>
<p>Here Km is the substrate concentration at which the velocity is half of Vmax. A low Km means high affinity between enzyme and substrate.</p>
<table><tr><th>Enzyme</th><th>Substrate</th><th>Km (mM)</th></tr><tr><td>Hexokinase</td><td>Glucose</td><td>0.15</td></tr><tr><td>Catalase</td><td>H2O2</td><td>25</td></tr></table>
<p>The following code estimates the velocity:</p>
<pre>def velocity(vmax, km, s):
    return vmax * s / (km + s)</pre>
</div>
<div class="page ar">
<h2>الإنزيمات في الجسم</h2>
<p>الإنزيمات بروتينات تسرّع التفاعلات الكيميائية في الخلايا الحية دون أن تُستهلك. ولكل إنزيم موقع نشط يرتبط بمادة متفاعلة محددة.</p>
<p>تتأثر سرعة التفاعل الإنزيمي بدرجة الحرارة ودرجة الحموضة وتركيز المادة المتفاعلة.</p>
</div>
<div class="page"><canvas id="scan" width="700" height="300"></canvas></div>
<div><h2>Summary</h2><p>Enzymes make metabolism possible. Remember the Michaelis–Menten equation and the meaning of Km for the exam.</p></div>
<script>
const c = document.getElementById("scan").getContext("2d");
c.fillStyle = "#fff"; c.fillRect(0, 0, 700, 300); c.fillStyle = "#111"; c.font = "28px Georgia";
c.fillText("Scanned page: Competitive inhibitors", 20, 70);
c.fillText("bind to the active site of the enzyme.", 20, 120);
</script>
</body></html>`;

// Microsoft Edge on Windows (as the browser tests use); elsewhere Playwright's Chromium.
const browser = await chromium.launch(process.platform === "win32" ? { channel: "msedge" } : {});
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
const pdf = await page.pdf({ format: "A4", printBackground: true });
const out = join(import.meta.dirname, "..", "tests", "fixtures", "lecture-enzymes.pdf");
writeFileSync(out, pdf);
console.log(out, pdf.length, "bytes");
await browser.close();
