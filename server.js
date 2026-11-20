// Banco Imobiliário Digital — servidor local
// Roda no notebook (que vira o Banco). Os celulares acessam pelo Wi-Fi.
// Sem dependências: só precisa do Node.js instalado.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'partida.json');

const DEFAULT_INITIAL_BALANCE = 2558000 * 100; // em centavos
const MAX_AMOUNT = 1e15; // limite de segurança (centavos)

// ---------------------------------------------------------------------------
// Estado do jogo (uma partida por servidor), salvo em disco a cada mudança
// ---------------------------------------------------------------------------

let game = null;

function loadGame() {
  try {
    game = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log(`Partida "${game.name}" carregada do disco.`);
  } catch {
    game = null;
  }
}

function saveGame() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!game) {
    try { fs.unlinkSync(DATA_FILE); } catch {}
    return;
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(game, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url');

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    icon: p.icon,
    cardColor: p.cardColor,
    cardName: p.cardName,
    cardNumber: p.cardNumber,
    balance: p.balance,
    joinedAt: p.joinedAt,
  };
}

function playerBrief(p) {
  return { id: p.id, name: p.name, color: p.color, icon: p.icon };
}

function partyInfo(id) {
  if (id === 'bank') return { id: 'bank', name: 'Banco', color: '#1f7a4d', icon: '🏦' };
  const p = game.players.find((x) => x.id === id);
  return p ? playerBrief(p) : { id, name: 'Jogador removido', color: '#888', icon: '❔' };
}

function txView(tx) {
  return { ...tx, fromInfo: partyInfo(tx.from), toInfo: partyInfo(tx.to) };
}

function getPlayer(id) {
  return game && game.players.find((p) => p.id === id);
}

function playerByToken(token) {
  return token && game && game.players.find((p) => p.token === token);
}

/**
 * Move dinheiro entre jogadores/banco. O banco tem dinheiro infinito.
 * allowNegative: só o banco pode deixar um jogador com saldo negativo (dívida).
 */
function moveMoney({ from, to, amount, description, kind, allowNegative = false }) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new HttpError(400, 'Valor inválido.');
  }
  if (from === to) throw new HttpError(400, 'Não dá pra pagar pra você mesmo.');
  const payer = from === 'bank' ? null : getPlayer(from);
  const payee = to === 'bank' ? null : getPlayer(to);
  if (from !== 'bank' && !payer) throw new HttpError(404, 'Pagador não encontrado.');
  if (to !== 'bank' && !payee) throw new HttpError(404, 'Recebedor não encontrado.');
  if (payer && !allowNegative && payer.balance < amount) {
    throw new HttpError(400, 'Saldo insuficiente.');
  }
  if (payer) payer.balance -= amount;
  if (payee) payee.balance += amount;
  const tx = {
    id: newId(),
    from,
    to,
    amount,
    description: String(description || '').slice(0, 80),
    kind: kind || 'transfer',
    at: Date.now(),
  };
  game.transactions.push(tx);
  return tx;
}

function newChargeCode() {
  const used = new Set(game.charges.filter((c) => c.status === 'pending').map((c) => c.code));
  for (let i = 0; i < 1000; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!used.has(code)) return code;
  }
  throw new HttpError(500, 'Não foi possível gerar um código.');
}

function chargeView(c) {
  return {
    id: c.id,
    code: c.code,
    amount: c.amount,
    description: c.description,
    status: c.status,
    createdAt: c.createdAt,
    to: partyInfo(c.to),
    paidBy: c.paidBy ? partyInfo(c.paidBy) : null,
  };
}

// ---------------------------------------------------------------------------
// Tempo real (Server-Sent Events)
// ---------------------------------------------------------------------------

const clients = new Set(); // { res, kind: 'bank' | 'player', playerId }

function broadcast(event = 'update', data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(payload);
}

function changed(extra) {
  saveGame();
  broadcast('update', extra || {});
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 20000);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function requireBank(req) {
  if (!isLocal(req)) {
    throw new HttpError(403, 'O painel do Banco só funciona no notebook que criou a partida.');
  }
}

function requireGame() {
  if (!game) throw new HttpError(404, 'Nenhuma partida em andamento.');
}

function requirePlayer(req) {
  requireGame();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const p = playerByToken(token);
  if (!p) throw new HttpError(401, 'Você não está na partida.');
  return p;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 100000) {
        reject(new HttpError(413, 'Requisição muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

function cleanText(v, max) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanColor(v, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback;
}

function parseAmount(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_AMOUNT) throw new HttpError(400, 'Valor inválido.');
  return n;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  // Prioriza redes domésticas comuns
  out.sort((a, b) => score(b) - score(a));
  return out;
  function score(ip) {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------

async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  let m;

  // --- Público -------------------------------------------------------------
  if (method === 'GET' && p === '/api/info') {
    return sendJson(res, 200, {
      exists: !!game,
      name: game ? game.name : null,
      players: game ? game.players.length : 0,
    });
  }

  // --- Eventos em tempo real -----------------------------------------------
  if (method === 'GET' && p === '/api/events') {
    const token = url.searchParams.get('token');
    let client;
    if (url.searchParams.get('bank') === '1') {
      requireBank(req);
      client = { res, kind: 'bank' };
    } else {
      const pl = playerByToken(token);
      if (!pl) throw new HttpError(401, 'Você não está na partida.');
      client = { res, kind: 'player', playerId: pl.id };
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.add(client);
    req.on('close', () => clients.delete(client));
    return;
  }

  // --- Jogador -------------------------------------------------------------
  if (method === 'POST' && p === '/api/join') {
    requireGame();
    const b = await readBody(req);
    if (cleanText(b.campaign, 60).toLowerCase() !== game.name.toLowerCase()) {
      throw new HttpError(400, 'Nome da campanha incorreto.');
    }
    if (String(b.password || '') !== game.password) {
      throw new HttpError(400, 'Senha incorreta.');
    }
    const name = cleanText(b.name, 24);
    if (!name) throw new HttpError(400, 'Digite seu nome.');
    if (game.players.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(400, 'Já existe um jogador com esse nome. Se for você, peça ao Banco o QR de reconexão.');
    }
    const color = cleanColor(b.color, '#e53935');
    const player = {
      id: newId(),
      token: newToken(),
      name,
      color,
      icon: cleanText(b.icon, 8) || '🎩',
      cardColor: cleanColor(b.cardColor, color),
      cardName: cleanText(b.cardName, 26) || name.toUpperCase(),
      cardNumber: String(crypto.randomInt(1000, 10000)),
      balance: 0,
      joinedAt: Date.now(),
    };
    game.players.push(player);
    if (game.initialBalance > 0) {
      moveMoney({
        from: 'bank',
        to: player.id,
        amount: game.initialBalance,
        description: 'Saldo inicial',
        kind: 'initial',
      });
    }
    changed();
    return sendJson(res, 200, { token: player.token });
  }

  if (method === 'GET' && p === '/api/me') {
    const me = requirePlayer(req);
    const txs = game.transactions
      .filter((t) => t.from === me.id || t.to === me.id)
      .slice(-300)
      .reverse()
      .map(txView);
    const myCharge = game.charges.filter((c) => c.to === me.id).slice(-1)[0];
    return sendJson(res, 200, {
      campaign: game.name,
      me: publicPlayer(me),
      players: game.players.filter((x) => x.id !== me.id).map(playerBrief),
      transactions: txs,
      charge: myCharge ? chargeView(myCharge) : null,
    });
  }

  if (method === 'PUT' && p === '/api/me') {
    const me = requirePlayer(req);
    const b = await readBody(req);
    if (b.cardColor !== undefined) me.cardColor = cleanColor(b.cardColor, me.cardColor);
    if (b.cardName !== undefined) me.cardName = cleanText(b.cardName, 26) || me.cardName;
    if (b.color !== undefined) me.color = cleanColor(b.color, me.color);
    if (b.icon !== undefined) me.icon = cleanText(b.icon, 8) || me.icon;
    changed();
    return sendJson(res, 200, { ok: true });
  }

  // Criar cobrança (o celular vira a maquininha)
  if (method === 'POST' && p === '/api/charges') {
    const me = requirePlayer(req);
    const b = await readBody(req);
    const amount = parseAmount(b.amount);
    // Cancela cobranças anteriores ainda abertas desse jogador
    for (const c of game.charges) {
      if (c.to === me.id && c.status === 'pending') c.status = 'cancelled';
    }
    const charge = {
      id: newId(),
      code: newChargeCode(),
      to: me.id,
      amount,
      description: cleanText(b.description, 60),
      status: 'pending',
      createdAt: Date.now(),
    };
    game.charges.push(charge);
    // Mantém só as últimas cobranças
    if (game.charges.length > 200) game.charges = game.charges.slice(-200);
    changed();
    return sendJson(res, 200, chargeView(charge));
  }

  if ((m = p.match(/^\/api\/charges\/([\w]+)$/))) {
    requireGame();
    const key = m[1];
    const charge =
      game.charges.find((c) => c.id === key) ||
      game.charges.find((c) => c.code === key && c.status === 'pending');
    if (!charge) throw new HttpError(404, 'Cobrança não encontrada. Confira o código.');

    if (method === 'GET') {
      requirePlayer(req);
      return sendJson(res, 200, chargeView(charge));
    }
    if (method === 'DELETE') {
      const me = requirePlayer(req);
      if (charge.to !== me.id) throw new HttpError(403, 'Essa cobrança não é sua.');
      if (charge.status === 'pending') charge.status = 'cancelled';
      changed();
      return sendJson(res, 200, chargeView(charge));
    }
  }

  // Cobrança aberta de um jogador (usado pelo link fixo /p/<id>, ex.: etiqueta NFC)
  if (method === 'GET' && (m = p.match(/^\/api\/players\/([\w]+)\/charge$/))) {
    requirePlayer(req);
    const pl = getPlayer(m[1]);
    if (!pl) throw new HttpError(404, 'Jogador não encontrado.');
    const charge = game.charges.filter((c) => c.to === pl.id && c.status === 'pending').slice(-1)[0];
    if (!charge) throw new HttpError(404, `${pl.name} não tem nenhuma cobrança aberta. Peça para tocar em “Receber” e digitar o valor.`);
    return sendJson(res, 200, chargeView(charge));
  }

  if (method === 'POST' && (m = p.match(/^\/api\/charges\/([\w]+)\/pay$/))) {
    const me = requirePlayer(req);
    const charge = game.charges.find((c) => c.id === m[1]);
    if (!charge) throw new HttpError(404, 'Cobrança não encontrada.');
    if (charge.status === 'paid') throw new HttpError(400, 'Essa cobrança já foi paga.');
    if (charge.status !== 'pending') throw new HttpError(400, 'Essa cobrança foi cancelada.');
    if (charge.to === me.id) throw new HttpError(400, 'Você não pode pagar sua própria cobrança.');
    const tx = moveMoney({
      from: me.id,
      to: charge.to,
      amount: charge.amount,
      description: charge.description,
      kind: 'charge',
    });
    charge.status = 'paid';
    charge.paidBy = me.id;
    charge.txId = tx.id;
    changed({ paidCharge: charge.id, tx: txView(tx) });
    return sendJson(res, 200, txView(tx));
  }

  // Transferência direta (escolhe o jogador ou o Banco)
  if (method === 'POST' && p === '/api/transfer') {
    const me = requirePlayer(req);
    const b = await readBody(req);
    const to = b.to === 'bank' ? 'bank' : getPlayer(b.to) ? b.to : null;
    if (!to) throw new HttpError(404, 'Destinatário não encontrado.');
    const tx = moveMoney({
      from: me.id,
      to,
      amount: parseAmount(b.amount),
      description: cleanText(b.description, 60),
      kind: 'transfer',
    });
    changed({ tx: txView(tx) });
    return sendJson(res, 200, txView(tx));
  }

  // --- Banco (só no notebook) ---------------------------------------------
  if (p.startsWith('/api/bank')) {
    requireBank(req);

    if (method === 'GET' && p === '/api/bank/state') {
      if (!game) return sendJson(res, 200, { exists: false, addresses: lanAddresses(), port: PORT });
      const bankIn = game.transactions.filter((t) => t.to === 'bank').reduce((s, t) => s + t.amount, 0);
      const bankOut = game.transactions.filter((t) => t.from === 'bank').reduce((s, t) => s + t.amount, 0);
      return sendJson(res, 200, {
        exists: true,
        name: game.name,
        password: game.password,
        initialBalance: game.initialBalance,
        createdAt: game.createdAt,
        addresses: lanAddresses(),
        port: PORT,
        bankIn,
        bankOut,
        players: game.players.map(publicPlayer),
        transactions: game.transactions.slice(-500).reverse().map(txView),
      });
    }

    if (method === 'POST' && p === '/api/bank/create') {
      if (game) throw new HttpError(400, 'Já existe uma partida. Encerre-a antes de criar outra.');
      const b = await readBody(req);
      const name = cleanText(b.name, 40);
      const password = String(b.password || '').trim().slice(0, 40);
      if (!name) throw new HttpError(400, 'Dê um nome para a campanha.');
      if (!password) throw new HttpError(400, 'Crie uma senha.');
      const initial = b.initialBalance === undefined ? DEFAULT_INITIAL_BALANCE : Number(b.initialBalance);
      if (!Number.isInteger(initial) || initial < 0 || initial > MAX_AMOUNT) {
        throw new HttpError(400, 'Saldo inicial inválido.');
      }
      game = {
        name,
        password,
        initialBalance: initial,
        createdAt: Date.now(),
        players: [],
        transactions: [],
        charges: [],
      };
      changed();
      return sendJson(res, 200, { ok: true });
    }

    requireGame();

    if (method === 'POST' && (p === '/api/bank/pay' || p === '/api/bank/charge')) {
      const b = await readBody(req);
      const ids = Array.isArray(b.playerIds) ? b.playerIds : [b.playerId];
      const amount = parseAmount(b.amount);
      const players = ids.map((id) => getPlayer(id));
      if (!players.length || players.some((x) => !x)) throw new HttpError(404, 'Jogador não encontrado.');
      const txs = players.map((pl) =>
        p === '/api/bank/pay'
          ? moveMoney({ from: 'bank', to: pl.id, amount, description: b.description, kind: 'bank' })
          : moveMoney({
              from: pl.id,
              to: 'bank',
              amount,
              description: b.description,
              kind: 'bank',
              allowNegative: true,
            })
      );
      changed({ txs: txs.map(txView) });
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && p === '/api/bank/reverse') {
      const b = await readBody(req);
      const tx = game.transactions.find((t) => t.id === b.txId);
      if (!tx) throw new HttpError(404, 'Transação não encontrada.');
      if (tx.reversed) throw new HttpError(400, 'Essa transação já foi estornada.');
      if (tx.kind === 'reversal') throw new HttpError(400, 'Não dá pra estornar um estorno.');
      const rev = moveMoney({
        from: tx.to,
        to: tx.from,
        amount: tx.amount,
        description: 'Estorno' + (tx.description ? `: ${tx.description}` : ''),
        kind: 'reversal',
        allowNegative: true,
      });
      tx.reversed = true;
      rev.reverses = tx.id;
      changed({ tx: txView(rev) });
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET' && (m = p.match(/^\/api\/bank\/reconnect\/([\w]+)$/))) {
      const pl = getPlayer(m[1]);
      if (!pl) throw new HttpError(404, 'Jogador não encontrado.');
      return sendJson(res, 200, { path: `/r/${pl.token}` });
    }

    if (method === 'DELETE' && (m = p.match(/^\/api\/bank\/players\/([\w]+)$/))) {
      const idx = game.players.findIndex((x) => x.id === m[1]);
      if (idx < 0) throw new HttpError(404, 'Jogador não encontrado.');
      game.players.splice(idx, 1);
      changed({ kicked: m[1] });
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && p === '/api/bank/end') {
      game = null;
      saveGame();
      broadcast('ended');
      return sendJson(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');

    // Páginas
    if (url.pathname === '/banco' || url.pathname === '/banco/') {
      return sendFile(res, path.join(PUBLIC_DIR, 'banco.html'));
    }
    if (url.pathname === '/' || url.pathname.startsWith('/pagar/') || url.pathname.startsWith('/p/') || url.pathname.startsWith('/r/')) {
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    // Arquivos estáticos
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Proibido');
    return sendFile(res, file);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Erro interno' });
    else res.end();
  }
});

loadGame();

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('');
  console.log('  🏦  Banco Imobiliário Digital rodando!');
  console.log('');
  console.log(`  Painel do Banco (abra NESTE notebook):  http://localhost:${PORT}/banco`);
  if (ips.length) {
    console.log(`  Jogadores (celulares no mesmo Wi-Fi):   http://${ips[0]}:${PORT}`);
    for (const ip of ips.slice(1)) console.log(`                                           http://${ip}:${PORT}`);
  } else {
    console.log('  ⚠️  Não encontrei uma rede Wi-Fi. Conecte o notebook ao Wi-Fi.');
  }
  console.log('');
  console.log('  Para parar o servidor: Ctrl + C');
  console.log('');
});
