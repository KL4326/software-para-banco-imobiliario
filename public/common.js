// Funções compartilhadas entre o app do jogador e o painel do Banco.
/* global qrcode */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Valores são guardados em centavos. Mostramos centavos só quando existem.
function money(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const hasCents = abs % 100 !== 0;
  const str = (abs / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const prefix = neg ? '− ' : sign ? '+ ' : '';
  return `${prefix}R$ ${str}`;
}

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Sem conexão com o Banco. Confira se está no mesmo Wi-Fi.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erro'), { status: res.status });
  return data;
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg, kind = 'info', ms = 3200) {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = h('div', { id: 'toasts' });
    document.body.append(wrap);
  }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  wrap.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

function buzz(pattern = 60) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

// ---------------------------------------------------------------------------
// QR Code (gera SVG sem internet)
// ---------------------------------------------------------------------------
function qrSvg(text, { dark = '#111', light = '#fff' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 3; // margem
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    }
  }
  const size = n + q * 2;
  const wrap = document.createElement('div');
  wrap.className = 'qr';
  wrap.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  return wrap;
}

// ---------------------------------------------------------------------------
// Campo de valor: digita em reais inteiros + botões rápidos
// ---------------------------------------------------------------------------
function moneyInput({ onChange, autofocus = false } = {}) {
  let reais = 0;
  const display = h('input', {
    class: 'money-input',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: 'R$ 0',
  });
  const fmt = () => (reais ? 'R$ ' + reais.toLocaleString('pt-BR') : '');
  const set = (v) => {
    reais = Math.max(0, Math.min(Math.floor(v) || 0, 9e12));
    display.value = fmt();
    onChange && onChange(reais * 100);
  };
  display.addEventListener('input', () => {
    const digits = display.value.replace(/\D/g, '').slice(0, 13);
    set(Number(digits || 0));
  });
  const quick = [
    [1000, '+1 mil'],
    [10000, '+10 mil'],
    [50000, '+50 mil'],
    [100000, '+100 mil'],
    [500000, '+500 mil'],
    [1000000, '+1 mi'],
  ];
  const chips = h(
    'div',
    { class: 'chips' },
    quick.map(([v, label]) =>
      h('button', { type: 'button', class: 'chip', onclick: () => { set(reais + v); buzz(15); } }, label)
    ),
    h('button', { type: 'button', class: 'chip chip-clear', onclick: () => set(0) }, 'Limpar')
  );
  const el = h('div', { class: 'money-field' }, display, chips);
  if (autofocus) setTimeout(() => display.focus(), 50);
  return { el, get cents() { return reais * 100; }, set: (cents) => set(cents / 100), focus: () => display.focus() };
}

// ---------------------------------------------------------------------------
// Modal (folha que sobe de baixo no celular)
// ---------------------------------------------------------------------------
function openSheet(title, content, { onClose } = {}) {
  const close = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 250);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e) => e.target === overlay && close() },
    h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, '✕')),
      h('div', { class: 'sheet-body' }, content)
    )
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return { close, body: $('.sheet-body', overlay) };
}

function avatar(p, size = '') {
  return h('span', { class: `avatar ${size}`, style: { background: p.color } }, p.icon);
}

const ICONS = ['🎩', '🚗', '🪙', '🐶', '🚢', '👢', '✈️', '🏍️', '💎', '🦖', '🤠', '👑', '🐱', '🚀', '🦄', '⚽', '🎸', '🍕', '🐸', '🦁'];
const COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#5e35b1', '#d81b60', '#6d4c41', '#546e7a', '#212121', '#00897b'];
const CARD_COLORS = ['#1a1a2e', '#0f3460', '#16213e', '#1e88e5', '#00897b', '#2e7d32', '#c62828', '#ad1457', '#6a1b9a', '#ef6c00', '#b8860b', '#37474f'];
