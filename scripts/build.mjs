// Empacota o frontend com esbuild → web/dist (JS/CSS com hash no nome + index.html com SEO por rota injetado pelo servidor).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const watch = process.argv.includes('--dev');
rmSync('web/dist', { recursive: true, force: true });
mkdirSync('web/dist/assets', { recursive: true });

const result = await build({
  entryPoints: ['web/src/main.tsx'], bundle: true, outdir: 'web/dist/assets', entryNames: '[name]-[hash]',
  jsx: 'automatic', target: 'es2020', minify: !watch, sourcemap: watch, metafile: true, logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  loader: { '.svg': 'dataurl' },
});
const outs = Object.keys(result.metafile.outputs);
const js = outs.find((o) => o.endsWith('.js'));
const css = outs.find((o) => o.endsWith('.css'));
const html = readFileSync('web/index.html', 'utf8')
  .replace('%CSS%', css ? `<link rel="stylesheet" href="/assets/${basename(css)}">` : '')
  .replace('%JS%', `<script type="module" src="/assets/${basename(js)}"></script>`);
writeFileSync('web/dist/index.html', html);
console.log('Frontend compilado em web/dist');
