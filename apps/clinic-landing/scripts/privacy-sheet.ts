import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { PRACTICE_SHEET_FIELDS, practicePrivacySheetSchema } from "../lib/legal/practice-privacy";

const args = process.argv.slice(2);
const arg = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes("--input") || !args.includes("--output")) {
  console.error("Usage: pnpm privacy:sheet --input clinics/<slug>/privacy-sheet.json --output <sheet.html>");
  process.exit(1);
}
const input = resolve(arg("--input"));
const output = resolve(arg("--output"));
if (input === output || !output.endsWith(".html")) throw new Error("Output must be a separate .html file");
const sheet = practicePrivacySheetSchema.parse(JSON.parse(readFileSync(input, "utf8")));
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fields = Object.entries(PRACTICE_SHEET_FIELDS).map(([key, label]) =>
  `<label>${esc(label)}<textarea name="${key}" rows="2" spellcheck="false">${esc(sheet[key as keyof typeof sheet])}</textarea><div class="print-value">${esc(sheet[key as keyof typeof sheet])}</div></label>`,
).join("\n");
const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Praxisblatt für Datenschutz und Impressum</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e9eeec;color:#172923;font:14px/1.4 system-ui,sans-serif}main{max-width:210mm;margin:24px auto;padding:12mm;background:white;border-radius:8px}h1{font-size:24px;margin:0 0 7px}p{margin:7px 0}.note{padding:10px 12px;background:#f6f2e8;border-left:3px solid #a9865b;font-size:12px}form{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:18px 0}label{font-size:11px;font-weight:600;break-inside:avoid}textarea{display:block;width:100%;height:49px;margin-top:4px;padding:7px;border:1px solid #a7b8b0;border-radius:3px;font:12px/1.35 system-ui,sans-serif;resize:vertical;color:#172923;background:white}label:last-child{grid-column:1/-1}textarea:focus{outline:2px solid #2e453e;outline-offset:1px}footer{font-size:11px;color:#3f554b}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}button{padding:10px 16px;background:#2e453e;border:0;border-radius:20px;color:white;font:inherit;cursor:pointer}#status{font-size:12px}input[type=file]{display:none}@media(max-width:580px){main{margin:0;padding:20px;border-radius:0}form{grid-template-columns:1fr}h1{font-size:22px}}@page{size:A4;margin:10mm}@media print{body{background:white;font-size:11px}main{margin:0;padding:0;max-width:none;border-radius:0}h1{font-size:20px}form{grid-template-columns:1fr 1fr;gap:8px 14px;margin:12px 0}textarea{height:47px;resize:none;font-size:11px}label{font-size:10px}.actions,#status{display:none}.note{font-size:11px}footer{font-size:10px}}
.print-value{display:none}@media print{textarea{display:none}.print-value{display:block;min-height:47px;margin-top:4px;padding:7px;border:1px solid #a7b8b0;border-radius:3px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;font-weight:400}}
</style></head><body><main>
<h1>Praxisblatt für Datenschutz und Impressum</h1>
<p>Eine Seite je Praxis. Diese Angaben füllen die Datenschutzinformation 14, Fassung vom 10.10.2026.</p>
<p class="note">Tragen Sie die tatsächlichen Anbieter und Verarbeitungsorte ein. Optionale Dienste bleiben leer, wenn sie nicht eingesetzt werden. Beim Drittlandtransfer ist eine ausdrückliche Angabe erforderlich. Platzhalter sperren die Veröffentlichung.</p>
<form id="sheet">${fields}</form>
<footer>Die Praxis bestätigt ihre eigenen Angaben und den Link zu ihrem Impressum. EINS ergänzt die technischen Anbieterangaben anhand der tatsächlich eingesetzten Dienste. Speichern Sie das ausgefüllte Blatt für die Übernahme durch EINS. Ohne vollständige Angaben wird die Zielseite nicht veröffentlicht.</footer>
<div class="actions"><button type="button" id="save">Angaben speichern</button><button type="button" id="load">Gespeicherte Angaben öffnen</button><button type="button" id="print">Drucken</button><input id="file" type="file" accept="application/json,.json"></div>
<p id="status" role="status">Die Angaben bleiben auf Ihrem Gerät. Es werden keine Daten versendet.</p>
</main><script>
const form=document.getElementById('sheet');
const syncPrint=()=>form.querySelectorAll('textarea').forEach(field=>{field.nextElementSibling.textContent=field.value;});
form.addEventListener('input',syncPrint);window.addEventListener('beforeprint',syncPrint);
document.getElementById('save').onclick=()=>{
 const data=Object.fromEntries(new FormData(form));
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='privacy-sheet.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 document.getElementById('status').textContent='Angaben gespeichert. Vor der Veröffentlichung prüft EINS die Vollständigkeit.';
};
document.getElementById('print').onclick=()=>window.print();
document.getElementById('load').onclick=()=>document.getElementById('file').click();
document.getElementById('file').onchange=async(event)=>{
 try{
  const file=event.target.files[0];if(!file)return;
  const data=JSON.parse(await file.text());const keys=[...new FormData(form).keys()];
  if(Object.keys(data).length!==keys.length||keys.some(key=>typeof data[key]!=='string'))throw new Error('shape');
  for(const key of keys)form.elements.namedItem(key).value=data[key];
  syncPrint();
  document.getElementById('status').textContent='Gespeicherte Angaben geöffnet.';
 }catch{document.getElementById('status').textContent='Diese Datei ist kein gültiges Praxisblatt. Bitte wählen Sie die gespeicherte privacy-sheet.json.';}
};
</script></body></html>`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, "utf8");
console.log(`Practice sheet saved: ${output}`);
