'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const base = path.join(root, '.migration', '2026-10-03');
const nodeModules = path.join(base, 'validation', 'node_modules');
const MarkdownIt = require(path.join(nodeModules, 'markdown-it'));
const katex = require(path.join(nodeModules, 'katex'));
const texmath = require(path.join(nodeModules, 'markdown-it-texmath'));
const { extendMarkdownIt } = require('./vscode-vault-callouts/extension.js');
const report = JSON.parse(fs.readFileSync(path.join(base, 'report.json'), 'utf8'));
const mathErrors = [], linkErrors = [];
let mathCount = 0, callouts = 0;
const engine = { ...katex, renderToString(formula, options) {
  mathCount++;
  try { return katex.renderToString(formula, { ...options, throwOnError: true, strict: 'ignore', trust: false }); }
  catch (e) { mathErrors.push({ formula, error: e.message }); return `<span class="math-error">${formula.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</span>`; }
} };
const md = extendMarkdownIt(new MarkdownIt({ html: true, linkify: true })).use(texmath, { engine, delimiters: 'dollars', katexOptions: { strict: 'ignore' } });
function stripFM(text) { return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''); }
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]); }
const style = fs.readFileSync(path.join(__dirname,'vscode-vault-callouts/preview.css'),'utf8');
const renderDir=path.join(base,'preview');fs.mkdirSync(renderDir,{recursive:true});
const previewAssets=path.join(base,'80附件');fs.mkdirSync(previewAssets,{recursive:true});
for(const f of files(path.join(root,'80附件')))fs.copyFileSync(f,path.join(previewAssets,path.basename(f)));
const noteFiles = [path.join(root,'00仓库导航.md'),path.join(root,'00主题索引.md'),...['10本地笔记','20洛谷文章','90模板','90说明'].flatMap(d=>files(path.join(root,d)).filter(f=>f.endsWith('.md')))];
let renderManifest=[];
for (const [i, f] of noteFiles.entries()) {
  const text = stripFM(fs.readFileSync(f,'utf8'));
  const beforeErrors=mathErrors.length;
  let rendered=md.render(text);
  callouts+=(rendered.match(/<details /g)||[]).length;
  for(const e of mathErrors.slice(beforeErrors))e.file=path.relative(root,f);
  const tokens=md.parse(text,{});
  for(const t of tokens)for(const c of t.children||[]) {
    const raw=c.attrGet?.(c.type==='image'?'src':'href');
    if(!raw || /^(?:https?:|mailto:|#|obsidian:)/i.test(raw))continue;
    const target=path.resolve(path.dirname(f),decodeURIComponent(raw.split('#')[0]));
    if(!fs.existsSync(target))linkErrors.push({file:path.relative(root,f),link:raw});
  }
  // Make local image paths readable from the preview directory, without modifying notes.
  rendered=rendered.replace(/src="([^"]+)"/g,(all,src)=>/^https?:|^data:/.test(src)?all:`src="../80附件/${path.basename(decodeURIComponent(src))}"`);
  const name=String(i).padStart(3,'0')+'.html';
  fs.writeFileSync(path.join(renderDir,name),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${path.basename(f)}</title><link rel="stylesheet" href="../validation/node_modules/katex/dist/katex.min.css"><style>body{font:16px/1.65 'Microsoft YaHei',sans-serif;max-width:1100px;padding:28px;margin:auto;color:#253047;background:#fff}pre{background:#f3f5f9;padding:16px;border-radius:6px;overflow:auto}code{font-family:Consolas,monospace;font-size:14px}img{max-width:100%}a{color:#246ab8}h1,h2{border-bottom:1px solid #ddd} .math-error{color:red}${style}</style><h1>${path.basename(f,'.md')}</h1>${rendered}</html>`);
  renderManifest.push({file:path.relative(root,f),html:name});
}
// Functional folding check: nested containers and default open/closed states.
const fixture='> [!info]+ 外层 $n$\n>\n> > [!warning]- 内层\n> >\n> > ```cpp\n> > cout << 1;\n> > ```\n\n> [!success]+ 另一个\n>\n> 完整正文\n';
const rendered=md.render(fixture);
assert.equal((rendered.match(/<details /g)||[]).length,3);
assert.equal((rendered.match(/<\/details>/g)||[]).length,3);
assert(rendered.includes('vault-warning code-line" data-line="2"><summary>'));
assert(!rendered.includes('[!'));
const result={markdownFiles:noteFiles.length,luoguArticles:report.notes.filter(x=>x.source==='luogu').length,codeBlocksPreserved:report.notes.reduce((s,n)=>s+n.code_blocks,0),callouts,mathFormulas:mathCount,mathErrors,linkErrors,renderManifest};
fs.writeFileSync(path.join(base,'validation.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,renderManifest:undefined},null,2));
