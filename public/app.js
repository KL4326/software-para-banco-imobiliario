// App do jogador (celular)
/* global $, $$, h, money, timeStr, api, store, toast, buzz, qrSvg, moneyInput, openSheet, avatar, ICONS, COLORS, CARD_COLORS */
'use strict';

const app = $('#app');
let token = store('bi_token');
let data = null; // resposta de /api/me
let tab = 'card';
let seenTx = null; // ids de transações já vistas (para avisar de dinheiro novo)
let events = null;
let pendingPay = null; // id de cobrança vindo de /pagar/<id>
const listeners = new Set(); // telas abertas que querem saber de atualizações

// ---------------------------------------------------------------------------
// Rotas especiais: /r/<token> (reconectar) e /pagar/<id> (QR de cobrança)
// ---------------------------------------------------------------------------
(function routes() {
  const p = location.pathname;
  let m;
  if ((m = p.match(/^\/r\/([\w-]+)/))) {
    token = m[1];
    store('bi_token', token);
    history.replaceState(null, '', '/');
  } else if ((m = p.match(/^\/pagar\/(\w+)/))) {
    pendingPay = m[1];
    history.replaceState(null, '', '/');
  } else if ((m = p.match(/^\/p\/(\w+)/))) {
    pendingPay = 'player:' + m[1];
    history.replaceState(null, '', '/');
  }
})();

// ---------------------------------------------------------------------------
// Entrar na campanha (3 passos)
// ---------------------------------------------------------------------------
async function showJoin() {
  stopEvents();
  let info = { exists: false };
  try { info = await api('/api/info'); } catch {}

  const draft = {
    campaign: info.name || '',
    password: '',
    name: '',
    icon: ICONS[0],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    cardName: '',
    cardColor: CARD_COLORS[0],
  };
  let step = 1;

  const render = () => {
    app.replaceChildren(
      h('div', { class: 'logo', style: { justifyContent: 'center', margin: '12px 0 6px' } },
        h('span', { class: 'mark' }, '🏦'), 'Banco Imobiliário Digital'),
      h('div', { class: 'steps' }, [1, 2, 3].map((i) => h('span', { class: i <= step ? 'on' : '' }))),
      pendingPay && step === 1
        ? h('div', { class: 'panel small', style: { marginBottom: '14px' } },
            '⚠️ Este navegador ainda não está conectado à partida. Se você já entrou antes, abra o jogo no mesmo navegador em que entrou — ou pague digitando o ',
            h('b', {}, 'código de 4 dígitos'), ' em “Pagar”.')
        : null,
      step === 1 ? step1() : step === 2 ? step2() : step3()
    );
  };

  function step1() {
    if (!info.exists) {
      return h('div', { class: 'panel col center' },
        h('div', { style: { fontSize: '2.5rem' } }, '⏳'),
        h('h2', {}, 'Nenhuma partida aberta'),
        h('p', { class: 'muted' }, 'Peça para quem está com o notebook criar a campanha no painel do Banco.'),
        h('button', { class: 'btn btn-primary btn-block', onclick: showJoin }, 'Tentar de novo'));
    }
    const err = h('div', { class: 'error' });
    const camp = h('input', { value: draft.campaign, autocomplete: 'off', autocapitalize: 'off' });
    const pass = h('input', { type: 'password', value: draft.password, autocomplete: 'off' });
    const next = async (e) => {
      e.preventDefault();
      draft.campaign = camp.value.trim();
      draft.password = pass.value;
      if (!draft.campaign || !draft.password) return (err.textContent = 'Preencha o nome e a senha.');
      if (draft.campaign.toLowerCase() !== (info.name || '').toLowerCase()) return (err.textContent = 'Nome da campanha incorreto.');
      step = 2;
      render();
    };
    return h('form', { class: 'panel col', onsubmit: next },
      h('h2', {}, 'Entrar na campanha'),
      h('label', { class: 'field' }, 'Nome da campanha', camp),
      h('label', { class: 'field' }, 'Senha', pass),
      err,
      h('button', { class: 'btn btn-primary btn-block btn-big' }, 'Continuar'));
  }

  function step2() {
    const err = h('div', { class: 'error' });
    const name = h('input', { value: draft.name, maxlength: 24, autocomplete: 'off', placeholder: 'Ex.: Keven' });
    const preview = h('div', { class: 'row', style: { justifyContent: 'center' } });
    const updatePreview = () => preview.replaceChildren(avatar(draft, 'lg'));
    updatePreview();
    const icons = h('div', { class: 'icons' }, ICONS.map((ic) =>
      h('button', { type: 'button', class: 'icon-pick' + (ic === draft.icon ? ' on' : ''), onclick: (e) => {
        draft.icon = ic; $$('.icon-pick', icons).forEach((b) => b.classList.remove('on'));
        e.currentTarget.classList.add('on'); updatePreview();
      } }, ic)));
    const colors = h('div', { class: 'swatches' }, COLORS.map((c) =>
      h('button', { type: 'button', class: 'swatch' + (c === draft.color ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: (e) => {
        draft.color = c; $$('.swatch', colors).forEach((b) => b.classList.remove('on'));
        e.currentTarget.classList.add('on'); updatePreview();
      } })));
    const next = (e) => {
      e.preventDefault();
      draft.name = name.value.trim();
      if (!draft.name) return (err.textContent = 'Digite seu nome.');
      if (!draft.cardName) draft.cardName = draft.name.toUpperCase();
      step = 3;
      render();
    };
    return h('form', { class: 'panel col', onsubmit: next },
      h('h2', {}, 'Quem é você?'),
      preview,
      h('label', { class: 'field' }, 'Seu nome', name),
      h('div', { class: 'field' }, h('b', { class: 'small' }, 'Ícone'), icons),
      h('div', { class: 'field' }, h('b', { class: 'small' }, 'Sua cor'), colors),
      err,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { draft.name = name.value; step = 1; render(); } }, 'Voltar'),
        h('button', { class: 'btn btn-primary grow btn-big' }, 'Continuar')));
  }

  function step3() {
    const err = h('div', { class: 'error' });
    const cardHolder = h('div');
    const fake = () => ({ ...draft, cardNumber: '0000', balance: info.initialBalance ?? null });
    const updateCard = () => cardHolder.replaceChildren(cardEl(fake(), { campaign: draft.campaign, hideBalance: true }));
    const cname = h('input', { value: draft.cardName, maxlength: 26, autocomplete: 'off', oninput: () => { draft.cardName = cname.value; updateCard(); } });
    updateCard();
    const colors = h('div', { class: 'swatches' }, CARD_COLORS.map((c) =>
      h('button', { type: 'button', class: 'swatch' + (c === draft.cardColor ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: (e) => {
        draft.cardColor = c; $$('.swatch', colors).forEach((b) => b.classList.remove('on'));
        e.currentTarget.classList.add('on'); updateCard();
      } })));
    const btn = h('button', { class: 'btn btn-primary grow btn-big' }, 'Gerar meu cartão');
    const submit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try {
        const r = await api('/api/join', { method: 'POST', body: draft });
        token = r.token;
        store('bi_token', token);
        buzz([40, 60, 40]);
        await start();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        if (/senha|campanha/i.test(ex.message)) { step = 1; render(); toast(ex.message, 'error'); }
        if (/nome/i.test(ex.message) && !/campanha/i.test(ex.message)) { step = 2; render(); toast(ex.message, 'error', 5000); }
      }
    };
    return h('form', { class: 'col', onsubmit: submit },
      h('div', { class: 'panel col' },
        h('h2', {}, 'Seu cartão'),
        cardHolder,
        h('label', { class: 'field' }, 'Nome no cartão', cname),
        h('div', { class: 'field' }, h('b', { class: 'small' }, 'Cor do cartão'), colors)),
      err,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { step = 2; render(); } }, 'Voltar'),
        btn));
  }

  render();
}

// ---------------------------------------------------------------------------
// Cartão
// ---------------------------------------------------------------------------
function cardEl(p, { campaign, hideBalance = false, onclick } = {}) {
  return h('div', { class: 'card', style: { background: p.cardColor, cursor: onclick ? 'pointer' : '' }, onclick },
    h('div', { class: 'card-top' },
      h('div', { class: 'card-brand' }, '🏦 ', campaign || 'Banco Imobiliário'),
      h('div', { class: 'card-contactless' }, ')))')),
    h('div', {},
      hideBalance ? h('div', { class: 'chip-gold' }) : [
        h('div', { class: 'card-balance-label' }, 'Saldo'),
        h('div', { class: 'card-balance' }, money(p.balance)),
      ]),
    h('div', { class: 'card-bottom' },
      h('div', {},
        h('div', { class: 'card-number' }, '•••• •••• •••• ', p.cardNumber),
        h('div', { class: 'card-name' }, p.cardName || p.name)),
      h('div', { class: 'card-icon' }, p.icon)));
}

// ---------------------------------------------------------------------------
// Tela principal
// ---------------------------------------------------------------------------
async function start() {
  try {
    await refresh();
  } catch (e) {
    if (e.status === 401 || e.status === 404) return logout();
    app.replaceChildren(h('div', { class: 'panel col center', style: { marginTop: '40px' } },
      h('div', { style: { fontSize: '2.5rem' } }, '📡'),
      h('h2', {}, 'Sem conexão com o Banco'),
      h('p', { class: 'muted' }, e.message),
      h('button', { class: 'btn btn-primary', onclick: start }, 'Tentar de novo')));
    return;
  }
  startEvents();
  if (pendingPay) {
    const id = pendingPay;
    pendingPay = null;
    openPay({ chargeKey: id });
  }
}

function logout(msg) {
  token = null;
  data = null;
  seenTx = null;
  store('bi_token', null);
  stopEvents();
  if (msg) toast(msg, 'info', 5000);
  showJoin();
}

async function refresh() {
  if (!token) return showJoin();
  data = await api('/api/me', { token });
  notifyIncoming();
  render();
  for (const fn of listeners) fn(data);
}

function notifyIncoming() {
  const ids = new Set(data.transactions.map((t) => t.id));
  if (seenTx) {
    for (const t of data.transactions) {
      if (seenTx.has(t.id)) continue;
      if (t.to === data.me.id && t.kind !== 'initial') {
        toast(`💰 ${money(t.amount, { sign: true })} de ${t.fromInfo.name}`, 'success', 4000);
        buzz([80, 60, 80]);
      } else if (t.from === data.me.id && t.kind === 'bank') {
        toast(`🏦 O Banco cobrou ${money(t.amount)}${t.description ? ' · ' + t.description : ''}`, 'error', 4500);
        buzz(200);
      }
    }
  }
  seenTx = ids;
}

function render() {
  if (!data) return;
  const me = data.me;
  const content = tab === 'card' ? cardTab() : historyTab();
  app.replaceChildren(
    h('div', { class: 'topbar' },
      h('div', { class: 'who' }, avatar(me), h('div', { style: { minWidth: 0 } }, h('b', {}, me.name), h('div', { class: 'muted small' }, data.campaign))),
      h('button', { class: 'icon-btn', 'aria-label': 'Personalizar', title: 'Personalizar', onclick: openEdit }, '⚙️')),
    content,
    h('nav', { class: 'tabbar' },
      h('button', { class: 'tab' + (tab === 'card' ? ' on' : ''), onclick: () => { tab = 'card'; render(); } }, h('span', { class: 'ico' }, '💳'), 'Cartão'),
      h('button', { class: 'tab' + (tab === 'history' ? ' on' : ''), onclick: () => { tab = 'history'; render(); } }, h('span', { class: 'ico' }, '🧾'), 'Extrato')));
}

function cardTab() {
  const me = data.me;
  const ch = data.charge && data.charge.status === 'pending' ? data.charge : null;
  return h('div', {},
    cardEl(me, { campaign: data.campaign, onclick: openEdit }),
    me.balance < 0 ? h('p', { class: 'error center' }, 'Você está devendo ao Banco!') : null,
    h('div', { class: 'actions' },
      h('button', { class: 'action action-pay', onclick: () => openPay() }, h('span', { class: 'ico' }, '📤'), 'Pagar'),
      h('button', { class: 'action action-receive', onclick: () => openReceive() }, h('span', { class: 'ico' }, '📥'), 'Receber')),
    ch ? h('button', { class: 'option', style: { marginTop: '14px' }, onclick: () => openReceive(ch) },
      h('span', { class: 'ico' }, '🧾'),
      h('span', { class: 'grow' }, h('b', {}, `Cobrança aberta: ${money(ch.amount)}`), h('span', { class: 'muted small' }, `Código ${ch.code} · toque para mostrar`))) : null,
    h('h3', { style: { margin: '24px 0 8px' } }, 'Últimas transações'),
    txList(data.transactions.slice(0, 5)),
    data.transactions.length > 5
      ? h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onclick: () => { tab = 'history'; render(); } }, 'Ver extrato completo')
      : null);
}

function historyTab() {
  const me = data.me;
  const txs = data.transactions;
  const inSum = txs.filter((t) => t.to === me.id && t.kind !== 'initial').reduce((s, t) => s + t.amount, 0);
  const outSum = txs.filter((t) => t.from === me.id).reduce((s, t) => s + t.amount, 0);
  return h('div', { class: 'col' },
    h('h2', {}, 'Extrato'),
    h('div', { class: 'row' },
      h('div', { class: 'panel grow' }, h('div', { class: 'muted small' }, 'Entradas'), h('b', { class: 'tx-amount in' }, money(inSum))),
      h('div', { class: 'panel grow' }, h('div', { class: 'muted small' }, 'Saídas'), h('b', { class: 'tx-amount out' }, money(outSum)))),
    h('div', { class: 'panel' }, txList(txs)));
}

function txList(txs) {
  if (!txs.length) return h('div', { class: 'empty' }, 'Nenhuma transação ainda.');
  const me = data.me;
  return h('div', { class: 'tx-list' }, txs.map((t) => {
    const incoming = t.to === me.id;
    const other = incoming ? t.fromInfo : t.toInfo;
    let title = incoming ? `Recebido de ${other.name}` : `Pago para ${other.name}`;
    if (t.kind === 'initial') title = 'Saldo inicial';
    if (t.kind === 'reversal') title = incoming ? `Estorno de ${other.name}` : `Estorno para ${other.name}`;
    if (t.kind === 'bank' && !incoming) title = 'Cobrado pelo Banco';
    if (t.kind === 'bank' && incoming) title = 'Pago pelo Banco';
    const sub = [t.kind === 'reversal' || t.kind === 'initial' ? '' : t.description, timeStr(t.at), t.reversed ? 'estornada' : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'tx' + (t.reversed ? ' reversed' : '') },
      avatar(other),
      h('div', { class: 'tx-main' }, h('div', { class: 'tx-title' }, title), h('div', { class: 'tx-sub' }, sub)),
      h('div', { class: 'tx-amount ' + (incoming ? 'in' : 'out') }, incoming ? money(t.amount, { sign: true }) : '− ' + money(t.amount)));
  }));
}

// ---------------------------------------------------------------------------
// Receber (o celular vira a maquininha)
// ---------------------------------------------------------------------------
function openReceive(existing) {
  const sheet = openSheet('Receber', h('div'), { onClose: () => listeners.delete(onUpdate) });
  let charge = existing || null;

  function onUpdate(d) {
    if (!charge || !d.charge || d.charge.id !== charge.id) return;
    if (d.charge.status !== charge.status) {
      charge = d.charge;
      draw();
    }
  }
  listeners.add(onUpdate);

  const descs = ['Aluguel', 'Venda de propriedade', 'Acordo', 'Outro'];

  function draw() {
    if (!charge) return sheet.body.replaceChildren(form());
    if (charge.status === 'paid') return sheet.body.replaceChildren(paid());
    if (charge.status === 'cancelled') { charge = null; return draw(); }
    return sheet.body.replaceChildren(terminal());
  }

  function form() {
    const err = h('div', { class: 'error' });
    let desc = '';
    const mi = moneyInput({ autofocus: true, onChange: (c) => { btn.disabled = !c; } });
    const chips = h('div', { class: 'chips' }, descs.map((d) => h('button', { type: 'button', class: 'chip', onclick: (e) => {
      desc = desc === d ? '' : d;
      $$('.chip', chips).forEach((b) => b.classList.toggle('on', b.textContent === desc));
      e.currentTarget.blur();
    } }, d)));
    const btn = h('button', { class: 'btn btn-primary btn-block btn-big', disabled: true }, 'Gerar cobrança');
    return h('form', { class: 'col', onsubmit: async (e) => {
      e.preventDefault();
      if (!mi.cents) return;
      btn.disabled = true;
      try {
        charge = await api('/api/charges', { method: 'POST', token, body: { amount: mi.cents, description: desc } });
        draw();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    } },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Quanto você quer receber?'),
      mi.el,
      h('div', { class: 'field' }, h('b', { class: 'small' }, 'Motivo (opcional)'), chips),
      err,
      btn);
  }

  function terminal() {
    const url = `${location.origin}/pagar/${charge.id}`;
    return h('div', { class: 'terminal' },
      h('div', { class: 'amount-big' }, money(charge.amount)),
      charge.description ? h('div', { class: 'muted' }, charge.description) : null,
      qrSvg(url),
      h('div', { class: 'muted small' }, 'Quem vai pagar aponta a câmera para o QR', h('br'), 'ou digita este código em “Pagar”:'),
      h('div', { class: 'code-big' }, charge.code),
      h('div', { class: 'pulse' }, 'Aguardando pagamento…'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
        try { await api(`/api/charges/${charge.id}`, { method: 'DELETE', token }); } catch {}
        charge = null;
        draw();
      } }, 'Cancelar cobrança'));
  }

  function paid() {
    buzz([80, 60, 80]);
    return h('div', { class: 'terminal' },
      h('div', { class: 'success-badge' }, '✓'),
      h('h2', {}, 'Pagamento recebido!'),
      h('div', { class: 'amount-big' }, money(charge.amount)),
      charge.paidBy ? h('div', { class: 'row', style: { justifyContent: 'center' } }, avatar(charge.paidBy, 'sm'), h('b', {}, charge.paidBy.name)) : null,
      h('div', { class: 'row', style: { width: '100%' } },
        h('button', { class: 'btn btn-ghost grow', onclick: () => sheet.close() }, 'Fechar'),
        h('button', { class: 'btn btn-primary grow', onclick: () => { charge = null; draw(); } }, 'Nova cobrança')));
  }

  draw();
}

// ---------------------------------------------------------------------------
// Pagar
// ---------------------------------------------------------------------------
function openPay({ chargeKey } = {}) {
  const sheet = openSheet('Pagar', h('div'));

  function home() {
    const err = h('div', { class: 'error' });
    const code = h('input', {
      class: 'code-input', inputmode: 'numeric', maxlength: 4, placeholder: '0000', autocomplete: 'off',
      oninput: () => {
        code.value = code.value.replace(/\D/g, '').slice(0, 4);
        if (code.value.length === 4) loadCharge(code.value, err);
      },
    });
    setTimeout(() => code.focus(), 80);
    sheet.body.replaceChildren(h('div', { class: 'col' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Digite o código que aparece na maquininha de quem vai receber:'),
      code,
      err,
      h('div', { class: 'option-list' },
        h('div', { class: 'option', style: { cursor: 'default' } },
          h('span', { class: 'ico' }, '📷'),
          h('span', {}, h('b', {}, 'Escanear QR Code'), h('span', { class: 'muted small' }, 'Abra a câmera do celular e aponte para o QR na tela do outro jogador.'))),
        h('button', { class: 'option', onclick: chooseRecipient },
          h('span', { class: 'ico' }, '👥'),
          h('span', {}, h('b', {}, 'Transferir direto'), h('span', { class: 'muted small' }, 'Escolha um jogador ou o Banco e digite o valor.'))))));
  }

  async function loadCharge(key, errEl) {
    try {
      const c = key.startsWith('player:')
        ? await api(`/api/players/${key.slice(7)}/charge`, { token })
        : await api(`/api/charges/${key}`, { token });
      if (c.status === 'paid') throw new Error('Essa cobrança já foi paga.');
      if (c.status !== 'pending') throw new Error('Essa cobrança foi cancelada.');
      if (c.to.id === data.me.id) throw new Error('Essa cobrança é sua — mostre para outro jogador.');
      confirm({
        to: c.to, amount: c.amount, description: c.description,
        pay: () => api(`/api/charges/${c.id}/pay`, { method: 'POST', token }),
      });
    } catch (ex) {
      if (errEl) errEl.textContent = ex.message;
      else { toast(ex.message, 'error', 4000); home(); }
      buzz(150);
    }
  }

  function chooseRecipient() {
    const all = [{ id: 'bank', name: 'Banco', icon: '🏦', color: '#1f7a4d' }, ...data.players];
    sheet.body.replaceChildren(h('div', { class: 'col' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Para quem você vai pagar?'),
      h('div', { class: 'option-list' }, all.map((p) =>
        h('button', { class: 'option', onclick: () => amountFor(p) }, avatar(p), h('b', {}, p.name)))),
      h('button', { class: 'btn btn-ghost', onclick: home }, 'Voltar')));
  }

  function amountFor(p) {
    const descs = p.id === 'bank' ? ['Compra de propriedade', 'Imposto', 'Construção', 'Multa'] : ['Aluguel', 'Compra de propriedade', 'Acordo'];
    let desc = '';
    const mi = moneyInput({ autofocus: true, onChange: (c) => { btn.disabled = !c; } });
    const chips = h('div', { class: 'chips' }, descs.map((d) => h('button', { type: 'button', class: 'chip', onclick: () => {
      desc = desc === d ? '' : d;
      $$('.chip', chips).forEach((b) => b.classList.toggle('on', b.textContent === desc));
    } }, d)));
    const btn = h('button', { class: 'btn btn-primary btn-block btn-big', disabled: true }, 'Continuar');
    sheet.body.replaceChildren(h('form', { class: 'col', onsubmit: (e) => {
      e.preventDefault();
      if (!mi.cents) return;
      confirm({
        to: p, amount: mi.cents, description: desc, back: () => amountFor(p),
        pay: () => api('/api/transfer', { method: 'POST', token, body: { to: p.id, amount: mi.cents, description: desc } }),
      });
    } },
      h('div', { class: 'row' }, avatar(p), h('b', {}, p.name)),
      mi.el,
      h('div', { class: 'field' }, h('b', { class: 'small' }, 'Motivo (opcional)'), chips),
      h('div', { class: 'muted small' }, 'Saldo disponível: ', money(data.me.balance)),
      btn,
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: chooseRecipient }, 'Voltar')));
  }

  function confirm({ to, amount, description, pay, back }) {
    const err = h('div', { class: 'error' });
    const insufficient = data.me.balance < amount;
    const btn = h('button', { class: 'btn btn-primary btn-block btn-big', disabled: insufficient }, '✓ Confirmar pagamento');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await pay();
        buzz([40, 50, 40]);
        sheet.body.replaceChildren(h('div', { class: 'terminal' },
          h('div', { class: 'success-badge' }, '✓'),
          h('h2', {}, 'Pagamento feito!'),
          h('div', { class: 'amount-big' }, money(amount)),
          h('div', { class: 'row', style: { justifyContent: 'center' } }, avatar(to, 'sm'), h('b', {}, to.name)),
          h('button', { class: 'btn btn-primary btn-block', onclick: () => sheet.close() }, 'Fechar')));
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        buzz(150);
      }
    });
    sheet.body.replaceChildren(h('div', { class: 'col' },
      h('div', { class: 'confirm-box' },
        h('div', { class: 'muted' }, 'Você vai pagar'),
        h('div', { class: 'amount-big' }, money(amount)),
        h('div', { class: 'muted' }, 'para'),
        h('div', { class: 'row' }, avatar(to, 'lg'), h('h2', {}, to.name)),
        description ? h('div', { class: 'chip on' }, description) : null),
      insufficient ? h('div', { class: 'error center' }, `Saldo insuficiente (você tem ${money(data.me.balance)}).`) : null,
      err,
      btn,
      h('button', { class: 'btn btn-ghost', onclick: back || home }, 'Cancelar')));
  }

  if (chargeKey) {
    sheet.body.replaceChildren(h('div', { class: 'empty' }, 'Carregando cobrança…'));
    loadCharge(chargeKey, null);
  } else home();
}

// ---------------------------------------------------------------------------
// Personalizar cartão / perfil
// ---------------------------------------------------------------------------
function openEdit() {
  const me = data.me;
  const draft = { cardName: me.cardName, cardColor: me.cardColor, icon: me.icon, color: me.color };
  const cardHolder = h('div');
  const upd = () => cardHolder.replaceChildren(cardEl({ ...me, ...draft }, { campaign: data.campaign }));
  upd();
  const cname = h('input', { value: draft.cardName, maxlength: 26, oninput: () => { draft.cardName = cname.value; upd(); } });
  const pick = (list, key, cls) => {
    const box = h('div', { class: cls === 'icon-pick' ? 'icons' : 'swatches' }, list.map((v) =>
      h('button', {
        type: 'button',
        class: cls + (v === draft[key] ? ' on' : ''),
        style: cls === 'swatch' ? { background: v } : undefined,
        'aria-label': v,
        onclick: (e) => {
          draft[key] = v; $$('.' + cls, box).forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on'); upd();
        },
      }, cls === 'icon-pick' ? v : '')));
    return box;
  };
  const sheet = openSheet('Personalizar', h('div', { class: 'col' },
    cardHolder,
    h('label', { class: 'field' }, 'Nome no cartão', cname),
    h('div', { class: 'field' }, h('b', { class: 'small' }, 'Cor do cartão'), pick(CARD_COLORS, 'cardColor', 'swatch')),
    h('div', { class: 'field' }, h('b', { class: 'small' }, 'Seu ícone'), pick(ICONS, 'icon', 'icon-pick')),
    h('div', { class: 'field' }, h('b', { class: 'small' }, 'Sua cor'), pick(COLORS, 'color', 'swatch')),
    h('button', { class: 'btn btn-primary btn-block btn-big', onclick: async () => {
      try {
        await api('/api/me', { method: 'PUT', token, body: draft });
        sheet.close();
        toast('Cartão atualizado!', 'success');
      } catch (ex) { toast(ex.message, 'error'); }
    } }, 'Salvar'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => {
      if (window.confirm('Sair da partida neste celular? Para voltar, o Banco precisa mostrar o seu QR de reconexão.')) {
        sheet.close();
        logout();
      }
    } }, 'Sair deste celular')));
}

// ---------------------------------------------------------------------------
// Tempo real
// ---------------------------------------------------------------------------
let connBanner = null;
let errorTimer = null;

function startEvents() {
  stopEvents();
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener('update', (e) => {
    try {
      const d = JSON.parse(e.data || '{}');
      if (d.kicked && data && d.kicked === data.me.id) return logout('Você foi removido da partida pelo Banco.');
    } catch {}
    refresh().catch((ex) => { if (ex.status === 401) logout('Você não está mais na partida.'); });
  });
  events.addEventListener('ended', () => logout('A partida foi encerrada pelo Banco.'));
  events.addEventListener('open', () => {
    clearTimeout(errorTimer);
    if (connBanner) { connBanner.remove(); connBanner = null; refresh().catch(() => {}); }
  });
  events.addEventListener('error', () => {
    clearTimeout(errorTimer);
    errorTimer = setTimeout(async () => {
      if (!connBanner) {
        connBanner = h('div', { class: 'conn' }, 'Reconectando ao Banco…');
        document.body.append(connBanner);
      }
      try { await api('/api/me', { token }); } catch (ex) { if (ex.status === 401) logout('Você não está mais na partida.'); }
    }, 2500);
  });
}

function stopEvents() {
  if (events) events.close();
  events = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token && data) refresh().catch(() => {});
});

if (token) start();
else showJoin();
