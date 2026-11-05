// Resume / profile file → plain text. Zero dependencies.
// Supports PDF (incl. Word, Google Docs, browser "Save as PDF" and LinkedIn "Save to PDF" exports),
// DOCX, and plain text / Markdown. Everything runs locally; the file never leaves your machine.
import { inflateRawSync, inflateSync } from 'node:zlib';

export const MAX_BYTES = 5 * 1024 * 1024;

export function detectType(buf, fileName = '') {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return /\.docx$/i.test(fileName) || readZip(buf).has('word/document.xml') ? 'docx' : 'zip';
  if (/\.(txt|md|text|rtf)$/i.test(fileName) || isProbablyText(buf)) return 'text';
  return 'unknown';
}

export function extractText(buf, fileName = '') {
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('File is larger than 5 MB'), { status: 413 });
  const type = detectType(buf, fileName);
  if (type === 'pdf') return { type, text: pdfText(buf) };
  if (type === 'docx') return { type, text: docxText(buf) };
  if (type === 'text') return { type, text: stripRtf(buf.toString('utf8')) };
  throw Object.assign(new Error('Unsupported file. Use a PDF, DOCX, or TXT resume (or a LinkedIn “Save to PDF” profile).'), { status: 415 });
}

function isProbablyText(buf) {
  const sample = buf.subarray(0, 4096);
  let bad = 0;
  for (const b of sample) if (b < 9 || (b > 13 && b < 32)) bad++;
  return sample.length > 0 && bad / sample.length < 0.02;
}

function stripRtf(s) {
  if (!s.startsWith('{\\rtf')) return s;
  return s.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
}

// ——— DOCX: a zip with word/document.xml ———

/** Minimal zip reader (central directory + stored/deflate entries). Returns Map<name, () => Buffer>. */
export function readZip(buf) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, () => {
      const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(dataStart, dataStart + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 50 * 1024 * 1024 });
      throw new Error(`Unsupported zip compression (${method})`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function docxText(buf) {
  const zip = readZip(buf);
  const doc = zip.get('word/document.xml');
  if (!doc) throw Object.assign(new Error('This .docx has no document body'), { status: 415 });
  const xml = doc().toString('utf8');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ——— PDF ———
// Reads every object (including those inside compressed object streams), decodes FlateDecode
// streams, maps fonts to their ToUnicode CMaps, then walks each page's content stream and
// turns text operators (Tj, TJ, ', ") into lines.

function pdfText(buf) {
  const src = buf.toString('latin1');
  const objects = new Map(); // num → { dict, stream: Buffer|null }

  const objRe = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = objRe.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end < 0) break;
    const body = src.slice(start, end);
    const sIdx = body.search(/\bstream\r?\n/);
    let dict = body;
    let stream = null;
    if (sIdx >= 0) {
      dict = body.slice(0, sIdx);
      const dataStart = start + sIdx + body.slice(sIdx).match(/^stream\r?\n/)[0].length;
      const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = lenMatch ? dataStart + Number(lenMatch[1]) : src.indexOf('endstream', dataStart);
      if (dataEnd > end || dataEnd < dataStart) dataEnd = src.indexOf('endstream', dataStart);
      stream = buf.subarray(dataStart, dataEnd);
    }
    objects.set(Number(m[1]), { dict, stream });
    objRe.lastIndex = end;
  }

  const decode = (o) => {
    if (!o?.stream) return null;
    if (o._decoded !== undefined) return o._decoded;
    let out = o.stream;
    if (/\/FlateDecode/.test(o.dict)) {
      try { out = inflateSync(out); } catch {
        try { out = inflateSync(out, { finishFlush: 2 }); } catch { out = null; }
      }
    } else if (/\/Filter/.test(o.dict) && !/\/FlateDecode/.test(o.dict)) out = null; // images etc.
    o._decoded = out;
    return out;
  };

  // objects packed inside /Type /ObjStm
  for (const o of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decode(o);
    if (!data) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const s = data.toString('latin1');
    const nums = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = nums[i * 2];
      const off = first + nums[i * 2 + 1];
      const next = i + 1 < n ? first + nums[i * 2 + 3] : s.length;
      if (!objects.has(num)) objects.set(num, { dict: s.slice(off, next), stream: null });
    }
  }

  const ref = (s) => { const r = /^\s*(\d+)\s+\d+\s+R/.exec(s || ''); return r ? Number(r[1]) : null; };
  const resolveDict = (s) => { const n = ref(s); return n != null ? objects.get(n)?.dict || '' : s || ''; };

  // font object → cmap
  const cmapCache = new Map();
  const fontCmap = (fontNum) => {
    if (cmapCache.has(fontNum)) return cmapCache.get(fontNum);
    const fd = objects.get(fontNum)?.dict || '';
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fd);
    const data = tu ? decode(objects.get(Number(tu[1]))) : null;
    const cmap = { map: data ? parseCmap(data.toString('latin1')) : null, twoByte: /Identity-H|Identity-V|Type0/.test(fd) };
    cmapCache.set(fontNum, cmap);
    return cmap;
  };

  // pages in order (follow /Kids from the root /Pages)
  const pages = [];
  const walk = (num, inherited, seen = new Set()) => {
    if (seen.has(num)) return;
    seen.add(num);
    const d = objects.get(num)?.dict || '';
    const res = /\/Resources\s*(<<[\s\S]*?>>\s*>>|\d+\s+\d+\s+R)/.exec(d)?.[1] || inherited;
    if (/\/Type\s*\/Pages\b/.test(d)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(d)?.[1] || '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), res, seen);
    } else if (/\/Type\s*\/Page\b/.test(d)) pages.push({ dict: d, res });
  };
  const rootPages = [...objects.entries()].find(([, o]) => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Parent/.test(o.dict));
  if (rootPages) walk(rootPages[0], '');
  else for (const [, o] of objects) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict, res: /\/Resources\s*(<<[\s\S]*?>>\s*>>|\d+\s+\d+\s+R)/.exec(o.dict)?.[1] || '' });

  const out = [];
  for (const page of pages) {
    const resDict = resolveDict(page.res);
    const fontBlock = resolveDict(/\/Font\s*(<<[^>]*>>|\d+\s+\d+\s+R)/.exec(resDict)?.[1] || '');
    const fonts = {};
    for (const f of fontBlock.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) fonts[f[1]] = Number(f[2]);
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict)?.[1] || '';
    const streams = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((c) => decode(objects.get(Number(c[1])))).filter(Boolean);
    out.push(contentToText(Buffer.concat(streams).toString('latin1'), (name) => (fonts[name] != null ? fontCmap(fonts[name]) : { map: null, twoByte: false })));
  }
  const text = out.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.replace(/\s/g, '').length < 40) throw Object.assign(new Error('Couldn’t read text from this PDF (it may be a scanned image). Try a DOCX or paste the text instead.'), { status: 422 });
  return text;
}

function parseCmap(s) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => {
    let r = '';
    for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(hex(h.slice(i, i + 4)));
    return r || String.fromCharCode(hex(h));
  };
  for (const block of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(hex(p[1]), uni(p[2]));
  }
  for (const block of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = hex(p[1]);
      const hi = hex(p[2]);
      if (hi - lo > 65535) continue;
      if (p[4]) {
        const base = hex(p[4].slice(-4));
        const prefix = p[4].length > 4 ? uni(p[4].slice(0, -4)) : '';
        for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(base + c - lo));
      } else {
        const list = [...p[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => uni(x[1]));
        list.forEach((u, i) => map.set(lo + i, u));
      }
    }
  }
  return map;
}

/** Tokenize a content stream and emit text, inserting newlines on line moves and spaces on gaps. */
function contentToText(cs, cmapFor) {
  let font = { map: null, twoByte: false };
  let fontSize = 10;
  let out = '';
  let lastY = null;
  const stack = [];
  const decodeBytes = (bytes) => {
    if (font.map) {
      let r = '';
      if (font.twoByte) for (let i = 0; i + 1 < bytes.length; i += 2) r += font.map.get((bytes[i] << 8) | bytes[i + 1]) ?? '';
      else for (const b of bytes) r += font.map.get(b) ?? String.fromCharCode(b);
      return r;
    }
    if (font.twoByte) return '';
    return Buffer.from(bytes).toString('latin1');
  };
  const newline = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const space = () => { if (out && !/[\s]$/.test(out)) out += ' '; };

  let i = 0;
  const n = cs.length;
  while (i < n) {
    const c = cs[i];
    if (c === '%') { while (i < n && cs[i] !== '\n' && cs[i] !== '\r') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { // literal string
      let depth = 1; i++;
      const bytes = [];
      while (i < n && depth > 0) {
        const ch = cs[i];
        if (ch === '\\') {
          const nx = cs[i + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }[nx];
          if (esc !== undefined) { bytes.push(esc); i += 2; continue; }
          if (/[0-7]/.test(nx)) { const oct = /^[0-7]{1,3}/.exec(cs.slice(i + 1, i + 4))[0]; bytes.push(parseInt(oct, 8) & 255); i += 1 + oct.length; continue; }
          if (nx === '\r' || nx === '\n') { i += nx === '\r' && cs[i + 2] === '\n' ? 3 : 2; continue; }
          i++; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && --depth === 0) { i++; break; }
        bytes.push(ch.charCodeAt(0) & 255); i++;
      }
      stack.push({ str: bytes });
      continue;
    }
    if (c === '<' && cs[i + 1] !== '<') { // hex string
      const end = cs.indexOf('>', i);
      let h = cs.slice(i + 1, end).replace(/\s/g, '');
      if (h.length % 2) h += '0';
      const bytes = [];
      for (let k = 0; k < h.length; k += 2) bytes.push(parseInt(h.slice(k, k + 2), 16));
      stack.push({ str: bytes });
      i = end + 1;
      continue;
    }
    if (c === '[') { stack.push({ arrStart: true }); i++; continue; }
    if (c === ']') {
      const arr = [];
      while (stack.length && !stack.at(-1).arrStart) arr.unshift(stack.pop());
      stack.pop();
      stack.push({ arr });
      i++;
      continue;
    }
    if (c === '<' && cs[i + 1] === '<') { const end = cs.indexOf('>>', i); i = end < 0 ? n : end + 2; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !/[\s/[\]()<>{}%]/.test(cs[j])) j++; stack.push({ name: cs.slice(i + 1, j) }); i = j; continue; }
    let j = i;
    while (j < n && !/[\s/[\]()<>{}%]/.test(cs[j])) j++;
    if (j === i) { i++; continue; }
    const tok = cs.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { stack.push({ num: Number(tok) }); continue; }
    // operator
    switch (tok) {
      case 'BI': { const e = cs.indexOf('EI', i); i = e < 0 ? n : e + 2; break; } // inline image
      case 'Tf': font = cmapFor(stack.at(-2)?.name); fontSize = Math.abs(stack.at(-1)?.num || 10) || 10; break;
      case 'Tj': out += decodeBytes(stack.at(-1)?.str || []); break;
      case "'": case '"': newline(); out += decodeBytes(stack.at(-1)?.str || []); break;
      case 'TJ':
        for (const el of stack.at(-1)?.arr || []) {
          if (el.str) out += decodeBytes(el.str);
          else if (el.num != null && el.num < -180) space();
        }
        break;
      case 'Td': case 'TD': {
        const ty = stack.at(-1)?.num ?? 0;
        const tx = stack.at(-2)?.num ?? 0;
        // per-glyph positioning (Chromium/Skia) moves ~0.5em per glyph; only a bigger jump is a word gap
        if (Math.abs(ty) > 0.5) newline(); else if (tx > fontSize * 1.2) space();
        break;
      }
      case 'Tm': {
        const y = stack.at(-1)?.num;
        if (lastY != null && y != null && Math.abs(y - lastY) > 0.5) newline(); else space();
        lastY = y;
        break;
      }
      case 'T*': newline(); break;
      case 'ET': space(); break;
      default: break;
    }
    stack.length = 0;
  }
  return out.replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ');
}
