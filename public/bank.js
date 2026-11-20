// Painel do Banco (notebook)
/* global $$, h, money, timeStr, api, store, toast, qrSvg, moneyInput, openSheet, avatar */
'use strict';

const app = document.getElementById('app');
let state = null;
let events = null;
let seen = null;

async function load() {
  try {
    state = await api('/api/bank/state');
  } catch (e) {
    app.replaceChildren(h('div', { class: 'create panel col center' },
      h('div', { style: { fontSize: '2.5rem' } }, '🔒'),
      h('h2', {}, 'Painel indisponível'),
      h('p', { class: 'muted' }, e.message),
      e.status === 403 ? h('p', { class: 'small muted' }, 'Abra http://localhost:' + location.port + '/banco no notebook onde o servidor está rodando.') : null));
    return;
  }
  if (!state.exists) {
    stopEvents();
    seen = null;
    return renderCreate();
  }
  notify();
  render();
  if (!events) startEvents();
}

function notify() {
  const ids = new Set(state.transactions.map((t) => t.id));
  if (seen) {
    for (const t of state.transactions) {
      if (!seen.has(t.id) && t.to === 'bank' && t.kind !== 'bank' && t.kind !== 'reversal') {
        toast(`🏦 ${t.fromInfo.name} pagou ${money(t.amount)} ao Banco${t.description ? ' · ' + t.description : ''}`, 'success', 4000);
      }
    }
  }
  seen = ids;
}

// ---------------------------------------------------------------------------
// Criar campanha
// ---------------------------------------------------------------------------
function renderCreate() {
  const err = h('div', { class: 'error' });
  const name = h('input', { maxlength: 40, autocomplete: 'off', placeholder: 'Ex.: Sexta em família' });
  const pass = h('input', { maxlength: 40, autocomplete: 'off', placeholder: 'Ex.: 1234' });
  const initial = moneyInput();
  initial.set(2558000 * 100);
  const btn = h('button', { class: 'btn btn-primary btn-block btn-big' }, 'Criar partida');
  app.replaceChildren(h('div', { class: 'wrap' }, h('form', { class: 'create panel col', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/api/bank/create', { method: 'POST', body: { name: name.value, password: pass.value, initialBalance: initial.cents } });
      await load();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  } },
    h('div', { class: 'logo' }, h('span', { class: 'mark' }, '🏦'), 'Nova campanha'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'Este notebook vai ser o Banco. Os jogadores entram pelo celular usando o nome e a senha.'),
    h('label', { class: 'field' }, 'Nome da campanha', name),
    h('label', { class: 'field' }, 'Senha', pass),
    h('div', { class: 'field' }, h('b', { class: 'small' }, 'Saldo inicial de cada jogador'), initial.el),
    err,
    btn)));
  setTimeout(() => name.focus(), 50);
}

// ---------------------------------------------------------------------------
// Painel principal
// ---------------------------------------------------------------------------
function joinUrl() {
  const ips = state.addresses || [];
  const chosen = store('bi_ip');
  const ip = ips.includes(chosen) ? chosen : ips[0];
  return ip ? `http://${ip}:${state.port}` : null;
}

function render() {
  const players = state.players;
  const totalPlayers = players.reduce((s, p) => s + p.balance, 0);
  const url = joinUrl();
  const ips = state.addresses || [];

  const joinBox = h('div', { class: 'panel join-box' },
    h('h3', {}, 'Entrar na partida'),
    url ? qrSvg(url) : h('p', { class: 'error' }, 'Notebook sem Wi-Fi! Conecte à mesma rede dos celulares.'),
    url ? h('div', { class: 'join-url' }, url) : null,
    ips.length > 1 ? h('label', { class: 'field small', style: { width: '100%' } }, 'Rede',
      h('select', { onchange: (e) => { store('bi_ip', e.target.value); render(); } },
        ips.map((ip) => h('option', { value: ip, selected: url && url.includes(ip) }, ip)))) : null,
    h('dl', { class: 'kv' },
      h('dt', {}, 'Campanha'), h('dd', {}, state.name),
      h('dt', {}, 'Senha'), h('dd', {}, state.password),
      h('dt', {}, 'Saldo inicial'), h('dd', {}, money(state.initialBalance))),
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Os celulares precisam estar no mesmo Wi-Fi deste notebook.'));

  const stats = h('div', { class: 'stats' },
    stat('Jogadores', String(players.length)),
    stat('Dinheiro com os jogadores', money(totalPlayers)),
    stat('Banco pagou', money(state.bankOut)),
    stat('Banco recebeu', money(state.bankIn)));

  const playerCards = players.length
    ? h('div', { class: 'players' }, players.map(playerCard))
    : h('div', { class: 'panel empty', style: { marginBottom: '18px' } }, 'Ninguém entrou ainda. Mostre o QR Code ao lado para os jogadores.');

  app.replaceChildren(h('div', { class: 'bank' },
    h('div', { class: 'bank-head' },
      h('div', { class: 'logo' }, h('span', { class: 'mark' }, '🏦'), 'Banco · ', state.name),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        players.length ? h('button', { class: 'btn btn-primary', onclick: () => openAction('pay', players.map((p) => p.id)) }, '💸 Pagar a todos') : null,
        h('button', { class: 'btn btn-ghost', onclick: endGame }, 'Encerrar partida'))),
    h('div', { class: 'bank-grid' },
      joinBox,
      h('div', {},
        stats,
        playerCards,
        h('div', { class: 'panel log' },
          h('h3', { style: { marginBottom: '8px' } }, 'Todas as transações'),
          logList(state.transactions))))));
}

function stat(label, value) {
  return h('div', { class: 'panel stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
}

function playerCard(p) {
  return h('div', { class: 'panel pcard', style: { '--pc': p.color } },
    h('div', { class: 'pcard-head' }, avatar(p), h('b', {}, p.name)),
    h('div', { class: 'pcard-bal' + (p.balance < 0 ? ' neg' : '') }, money(p.balance)),
    h('div', { class: 'pcard-actions' },
      h('button', { class: 'btn btn-primary', onclick: () => openAction('pay', [p.id]) }, 'Pagar'),
      h('button', { class: 'btn btn-danger', onclick: () => openAction('charge', [p.id]) }, 'Cobrar')),
    h('div', { class: 'pcard-more' },
      h('button', { class: 'btn btn-ghost', onclick: () => reconnect(p) }, '🔗 Reconectar'),
      h('button', { class: 'btn btn-ghost', onclick: () => removePlayer(p) }, 'Remover')));
}

function logList(txs) {
  if (!txs.length) return h('div', { class: 'empty' }, 'Nenhuma transação ainda.');
  return h('div', {}, txs.map((t) => h('div', { class: 'log-row' + (t.reversed ? ' reversed' : '') },
    h('span', { class: 'log-time' }, timeStr(t.at)),
    h('div', { class: 'log-flow' },
      avatar(t.fromInfo, 'sm'), h('b', {}, t.fromInfo.name),
      h('span', { class: 'muted' }, '→'),
      avatar(t.toInfo, 'sm'), h('b', {}, t.toInfo.name),
      t.description ? h('span', { class: 'muted small' }, '· ' + t.description) : null,
      t.reversed ? h('span', { class: 'muted small' }, '· estornada') : null),
    h('span', { class: 'tx-amount' }, money(t.amount)),
    h('button', {
      class: 'mini-btn',
      disabled: t.reversed || t.kind === 'reversal' || t.kind === 'initial',
      title: 'Desfazer esta transação',
      onclick: () => reverse(t),
    }, 'Estornar'))));
}

// ---------------------------------------------------------------------------
// Ações do Banco
// ---------------------------------------------------------------------------
function openAction(mode, ids) {
  const isPay = mode === 'pay';
  const selected = new Set(ids);
  const descs = isPay
    ? ['Salário', 'Sorte', 'Venda ao Banco', 'Hipoteca', 'Prêmio']
    : ['Compra de propriedade', 'Imposto', 'Multa', 'Construção', 'Revés', 'Juros'];
  let desc = '';
  const err = h('div', { class: 'error' });

  const picks = h('div', { class: 'player-picks' }, state.players.map((p) =>
    h('button', {
      type: 'button',
      class: 'chip player-pick' + (selected.has(p.id) ? ' on' : ''),
      onclick: (e) => {
        selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id);
        e.currentTarget.classList.toggle('on', selected.has(p.id));
        updateBtn();
      },
    }, p.icon, ' ', p.name)));
  const mi = moneyInput({ autofocus: true, onChange: () => updateBtn() });
  const chips = h('div', { class: 'chips' }, descs.map((d) => h('button', { type: 'button', class: 'chip', onclick: () => {
    desc = desc === d ? '' : d;
    $$('.chip', chips).forEach((b) => b.classList.toggle('on', b.textContent === desc));
  } }, d)));
  const btn = h('button', { class: 'btn btn-block btn-big ' + (isPay ? 'btn-primary' : 'btn-danger') });
  function updateBtn() {
    const n = selected.size;
    btn.disabled = !n || !mi.cents;
    const who = n === 1 ? state.players.find((p) => selected.has(p.id))?.name : `${n} jogadores`;
    btn.textContent = mi.cents && n
      ? `${isPay ? 'Pagar' : 'Cobrar'} ${money(mi.cents)} ${isPay ? 'para' : 'de'} ${who}`
      : isPay ? 'Pagar' : 'Cobrar';
  }
  updateBtn();

  const sheet = openSheet(isPay ? 'Banco paga' : 'Banco cobra', h('form', { class: 'col', onsubmit: async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await api(isPay ? '/api/bank/pay' : '/api/bank/charge', {
        method: 'POST',
        body: { playerIds: [...selected], amount: mi.cents, description: desc },
      });
      sheet.close();
      toast(isPay ? 'Pagamento feito!' : 'Cobrança feita!', 'success');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  } },
    h('div', { class: 'field' }, h('b', { class: 'small' }, isPay ? 'Para quem' : 'De quem'), picks),
    mi.el,
    h('div', { class: 'field' }, h('b', { class: 'small' }, 'Motivo (opcional)'), chips),
    !isPay ? h('p', { class: 'muted small', style: { margin: 0 } }, 'O valor sai do saldo do jogador na hora. Se ele não tiver dinheiro, fica negativo (devendo).') : null,
    err,
    btn));
}

async function reverse(t) {
  if (!confirm(`Estornar ${money(t.amount)} de ${t.fromInfo.name} → ${t.toInfo.name}?\nO dinheiro volta para quem pagou.`)) return;
  try {
    await api('/api/bank/reverse', { method: 'POST', body: { txId: t.id } });
    toast('Transação estornada.', 'success');
  } catch (ex) { toast(ex.message, 'error'); }
}

async function reconnect(p) {
  try {
    const r = await api(`/api/bank/reconnect/${p.id}`);
    const base = joinUrl() || location.origin;
    const url = base + r.path;
    openSheet(`Reconectar ${p.name}`, h('div', { class: 'terminal' },
      h('p', { class: 'muted', style: { margin: 0 } }, `Peça para ${p.name} apontar a câmera do celular para este QR. Ele volta para a partida com o mesmo cartão e saldo.`),
      qrSvg(url),
      h('p', { class: 'small error', style: { margin: 0 } }, 'Não mostre para outros jogadores: quem escanear entra como ' + p.name + '.'),
      h('details', { style: { width: '100%', textAlign: 'left' } },
        h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Link para etiqueta NFC (opcional)'),
        h('p', { class: 'small muted' }, `Grave este link numa etiqueta NFC e cole no celular de ${p.name}. Quem encostar na etiqueta paga a cobrança aberta dele:`),
        h('div', { class: 'join-url' }, `${base}/p/${p.id}`))));
  } catch (ex) { toast(ex.message, 'error'); }
}

async function removePlayer(p) {
  if (!confirm(`Remover ${p.name} da partida? O saldo dele (${money(p.balance)}) some junto.`)) return;
  try {
    await api(`/api/bank/players/${p.id}`, { method: 'DELETE' });
    toast(`${p.name} foi removido.`);
  } catch (ex) { toast(ex.message, 'error'); }
}

async function endGame() {
  if (!confirm('Encerrar a partida? Todos os saldos e transações serão apagados.')) return;
  if (!confirm('Tem certeza mesmo? Não dá para desfazer.')) return;
  try {
    await api('/api/bank/end', { method: 'POST' });
    await load();
  } catch (ex) { toast(ex.message, 'error'); }
}

// ---------------------------------------------------------------------------
// Tempo real
// ---------------------------------------------------------------------------
function startEvents() {
  events = new EventSource('/api/events?bank=1');
  events.addEventListener('update', () => load());
  events.addEventListener('ended', () => load());
  events.addEventListener('open', () => load());
}

function stopEvents() {
  if (events) events.close();
  events = null;
}

load();
