# 🏦 Banco Imobiliário Digital

Cartão digital e "maquininha" no celular para jogar Banco Imobiliário sem notas de papel.

- O **notebook** roda o servidor e vira o **Banco**: vê o saldo de todos, todas as transações, paga, cobra e estorna.
- Cada **jogador** entra pelo navegador do celular (iPhone ou Android, sem instalar nada), escolhe nome, cor e ícone e ganha um **cartão digital**.
- **Receber**: o jogador digita o valor e o celular vira a maquininha, com um QR Code e um código de 4 dígitos.
- **Pagar**: o outro jogador aponta a câmera para o QR (ou digita o código), confere e confirma.
- Funciona só com o Wi-Fi de casa, **sem precisar de internet**.

## O que precisa

- Um notebook com o **Node.js** instalado (versão 18 ou mais nova): https://nodejs.org (baixe a versão "LTS").
- Notebook e celulares conectados **no mesmo Wi-Fi**.

## Como jogar

### 1. Ligar o Banco (no notebook)

Baixe este projeto, abra o terminal na pasta dele e rode:

```bash
node server.js
```

Vai aparecer algo assim:

```
Painel do Banco (abra NESTE notebook):  http://localhost:3000/banco
Jogadores (celulares no mesmo Wi-Fi):   http://192.168.0.15:3000
```

> **Windows:** se aparecer um aviso do Firewall, clique em **Permitir acesso** (marque "Redes privadas"). Sem isso os celulares não conseguem conectar.

### 2. Criar a campanha

No notebook, abra **http://localhost:3000/banco**, dê um nome para a campanha e crie uma senha. O saldo inicial já vem com **R$ 2.558.000**, mas dá para mudar.

### 3. Jogadores entram

No celular, aponte a câmera para o QR Code que aparece no painel do Banco, digite a senha, escolha nome, ícone e cor e monte o cartão.

### 4. Pagando e recebendo

| Quem | O que faz |
|---|---|
| Quem **recebe** | Toca em **Receber**, digita o valor e toca em **Gerar cobrança**. A tela mostra o QR e o código. |
| Quem **paga** | Aponta a **câmera do celular** para o QR **ou** toca em **Pagar** e digita o código de 4 dígitos. Confere e toca em **Confirmar pagamento**. |
| Pagar ao **Banco** | **Pagar → Transferir direto → Banco**. |
| O **Banco** | No notebook: **Pagar** ou **Cobrar** em cada jogador, **Pagar a todos** e **Estornar** uma transação errada. |

## Dicas e problemas comuns

- **Abra o jogo sempre no mesmo navegador** (Safari no iPhone, Chrome no Android). O QR da maquininha abre no navegador padrão do celular. Se o jogador entrou por outro navegador, ou adicionou o jogo à tela de início do iPhone, o QR abre "deslogado". Nesse caso é só pagar digitando o **código de 4 dígitos**.
- **Trocou de celular ou fechou o navegador e saiu do jogo?** No painel do Banco, toque em **🔗 Reconectar** no jogador e ele escaneia o QR. Volta com o mesmo cartão e saldo.
- **O celular não abre o endereço?** Confira se está no mesmo Wi-Fi do notebook (e não no 4G) e se o Firewall do Windows liberou o Node.js.
- **Caiu a energia ou fechou o terminal?** A partida fica salva em `data/partida.json`. É só rodar `node server.js` de novo.
- **O Banco pode deixar saldo negativo** ao cobrar (o jogador fica devendo). Já entre jogadores, não dá para pagar sem saldo.
- **Mudar a porta:** `PORT=4000 node server.js` (no Windows PowerShell: `$env:PORT=4000; node server.js`).

## Opcional: NFC ("encostar e pagar")

Hoje o pagamento é por QR Code ou código, mas o sistema já aceita etiquetas NFC:

1. Compre etiquetas NFC adesivas (modelo **NTAG213/215**) e cole uma na capinha de cada celular.
2. No painel do Banco, toque em **🔗 Reconectar** no jogador e abra **"Link para etiqueta NFC"**. O link é algo como `http://192.168.0.15:3000/p/abc123`.
3. Grave esse link na etiqueta com um app gratuito como o **NFC Tools** (iPhone ou Android), escolhendo "Escrever → URL".

Pronto: o jogador toca em **Receber** e digita o valor. Quem vai pagar encosta o celular na etiqueta, e a tela de confirmação abre sozinha. Funciona em iPhone XS ou mais novo e em Android com NFC ligado.

> O IP do notebook pode mudar de um dia para o outro. Se mudar, é preciso gravar as etiquetas de novo. Para evitar isso, dá para fixar o IP do notebook no roteador.
