'use strict';
// Programa de impressão TapMenu — pareamento por código + impressão de comandas.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const readline = require('node:readline');
const { exec, spawn } = require('node:child_process');

const VERSAO = require('../package.json').version;
const REPO = 'thiagoleal1991-max/tapmenu-impressao';
const PASTA = path.join(process.env.LOCALAPPDATA || os.homedir(), 'TapMenuImpressao');
const ARQ_CONFIG = path.join(PASTA, 'config.json');
const ARQ_LOG = path.join(PASTA, 'log.txt');
const INTERVALO_MS = 5000;
const PADRAO = require('../config.json');
fs.mkdirSync(PASTA, { recursive: true });

function log(msg) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${msg}`;
  try { console.log(linha); } catch {}
  try {
    if (fs.existsSync(ARQ_LOG) && fs.statSync(ARQ_LOG).size > 1_000_000) fs.renameSync(ARQ_LOG, ARQ_LOG + '.old');
    fs.appendFileSync(ARQ_LOG, linha + '\n');
  } catch {}
}
process.on('uncaughtException', (e) => log('[ERRO] ' + (e && e.message)));
process.on('unhandledRejection', (e) => log('[ERRO] ' + (e && e.message)));

const perguntar = (txt) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(txt, (r) => { rl.close(); res(r.trim()); });
});
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const lerConfig = () => { try { return JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')); } catch { return null; } };

async function configRemota() {
  // Permite corrigir endereços sem reinstalar (config.json do repositório).
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/config.json`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) return { ...PADRAO, ...(await r.json()) };
  } catch {}
  return PADRAO;
}

// ---------- Pareamento ----------
async function parear() {
  console.log('\n=== TapMenu — conectar impressora ===');
  console.log('No painel TapMenu: Configurações > Impressoras > "Conectar computador" e copie o código de 6 caracteres.\n');
  const cfg = await configRemota();
  for (;;) {
    const codigo = (await perguntar('Digite o código de pareamento: ')).toUpperCase().replace(/\s/g, '');
    if (!codigo) continue;
    const nome = os.hostname();
    try {
      const r = await fetch(`${cfg.app_url}/api/public/parear-agente`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codigo, nome, versao: VERSAO, plataforma: `${process.platform}-${process.arch}` }),
        signal: AbortSignal.timeout(20000),
      });
      const texto = await r.text();
      let dados = {};
      try { dados = JSON.parse(texto); } catch {}
      if (!r.ok || !dados.token) {
        log(`Pareamento recusado: HTTP ${r.status} ${r.headers.get('content-type')} ${r.url} :: ${texto.slice(0, 200).replace(/\s+/g, ' ')}`);
        console.log(`\n✗ ${dados.error || 'Não foi possível conectar (HTTP ' + r.status + (dados.error ? '' : ', resposta inesperada do servidor') + ')'}\n  Gere um novo código no painel e tente de novo.\n`); continue;
      }
      const conf = { supabase_url: cfg.supabase_url, supabase_key: cfg.supabase_key, tenant_id: dados.tenant_id, agente_id: dados.agente_id, token: dados.token, loja_nome: dados.loja_nome };
      fs.writeFileSync(ARQ_CONFIG, JSON.stringify(conf, null, 2));
      console.log(`\n✓ Conectado à loja "${dados.loja_nome || ''}". Pode fechar esta janela; a impressão continua em segundo plano.`);
      log(`Pareado com a loja ${dados.loja_nome} (${dados.tenant_id})`);
      return conf;
    } catch (e) {
      console.log(`\n✗ Sem conexão com o servidor (${e.message}). Verifique a internet e tente de novo.\n`);
    }
  }
}

// ---------- Chamadas ao servidor ----------
let CONF;
async function fn(nome, body) {
  const r = await fetch(`${CONF.supabase_url}/functions/v1/${nome}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CONF.supabase_key, authorization: `Bearer ${CONF.supabase_key}`, 'x-agente-token': CONF.token },
    body: JSON.stringify({ tenant_id: CONF.tenant_id, versao: VERSAO, plataforma: process.platform, ...body }),
    signal: AbortSignal.timeout(20000),
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 403) { const e = new Error('Este computador foi desconectado no painel. Pareie novamente.'); e.revogado = true; throw e; }
  if (!r.ok) throw new Error(dados.error || `HTTP ${r.status}`);
  return dados;
}

// ---------- Envio para a impressora ----------
function execP(cmd) {
  return new Promise((res, rej) => exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : undefined, windowsHide: true }, (e, so, se) => (e ? rej(new Error((se || e.message).trim())) : res(so))));
}
async function imprimirUsb(nome, buf) {
  const tmp = path.join(os.tmpdir(), `tapmenu-${Date.now()}.prn`);
  fs.writeFileSync(tmp, buf);
  try {
    if (process.platform === 'win32') await execP(`copy /b "${tmp}" "\\\\localhost\\${nome}"`);
    else await execP(`lp -d "${nome}" -o raw "${tmp}"`);
  } finally { fs.unlink(tmp, () => {}); }
}
function imprimirRede(ip, porta, buf) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    const t = setTimeout(() => { s.destroy(); reject(new Error(`Timeout em ${ip}:${porta}`)); }, 8000);
    s.connect(porta, ip, () => s.write(buf, (e) => { clearTimeout(t); if (e) { s.destroy(); return reject(e); } s.end(); resolve(); }));
    s.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
function bufferDoItem(item) {
  if (item.escpos_base64) return Buffer.from(item.escpos_base64, 'base64');
  const c = item.escpos_payload;
  if (!c) return null;
  return Buffer.from(c, /^[A-Za-z0-9+/=]+$/.test(c) ? 'base64' : 'utf-8');
}

let impressorasCache = [], impressorasEm = 0;
async function impressoras() {
  if (Date.now() - impressorasEm > 30000) {
    impressorasCache = (await fn('listar-impressoras-ativas', {})).impressoras || [];
    impressorasEm = Date.now();
  }
  return impressorasCache;
}

let ocupado = false;
async function ciclo() {
  if (ocupado) return;
  ocupado = true;
  try {
    const dados = await fn('processar-fila-impressao', {});
    const itens = dados.itens || [];
    if (!itens.length) return;
    log(`${itens.length} item(ns) na fila.`);
    const todas = await impressoras();
    for (const item of itens) {
      let ok = false, erro = item.error || null;
      const buf = erro ? null : bufferDoItem(item);
      if (!buf && !erro) erro = 'Item sem conteúdo ESC/POS';
      if (buf) {
        const alvo = item.impressora_id ? todas.filter((p) => p.id === item.impressora_id) : todas;
        const lista = alvo.length ? alvo : todas;
        if (!lista.length) erro = 'Nenhuma impressora ativa cadastrada';
        for (const p of lista) {
          try {
            if (p.tipo_conexao === 'usb') await imprimirUsb(p.nome_impressora_spooler, buf);
            else await imprimirRede(p.ip_local, p.porta || 9100, buf);
            log(`✓ Impresso em "${p.nome}" (${item.tipo || 'pedido'} ${item.numero ?? item.pedido_id ?? ''})`);
            ok = true;
          } catch (e) { erro = e.message; log(`[ERRO] "${p.nome}": ${e.message}`); }
        }
      }
      try { await fn('marcar-impressao-processada', { fila_id: item.id, status: ok ? 'processado' : 'erro', erro_mensagem: ok ? null : (erro || 'Falha ao imprimir') }); }
      catch (e) { log(`[ERRO] marcar ${item.id}: ${e.message}`); }
    }
  } catch (e) {
    log(`[ERRO] ${e.message}`);
    if (e.revogado) { try { fs.unlinkSync(ARQ_CONFIG); } catch {} process.exit(2); }
  } finally { ocupado = false; }
}

// ---------- Atualização automática (GitHub Releases) ----------
const versaoNum = (v) => String(v).replace(/^v/, '').split('.').map(Number);
const maior = (a, b) => { const x = versaoNum(a), y = versaoNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function verificarAtualizacao() {
  if (process.platform !== 'win32') return;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'user-agent': 'tapmenu-impressao' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return;
    const rel = await r.json();
    if (!maior(rel.tag_name, VERSAO)) return;
    const asset = (rel.assets || []).find((a) => /Setup\.exe$/i.test(a.name));
    if (!asset) return;
    log(`Nova versão ${rel.tag_name} — baixando…`);
    const d = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
    const dest = path.join(os.tmpdir(), asset.name);
    fs.writeFileSync(dest, Buffer.from(await d.arrayBuffer()));
    log('Atualizando…');
    spawn(dest, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => process.exit(0), 1500);
  } catch (e) { log(`[AVISO] verificação de atualização falhou: ${e.message}`); }
}

// ---------- Execução ----------
async function principal() {
  const args = process.argv.slice(2);
  if (args.includes('--versao')) { console.log(VERSAO); return; }
  CONF = lerConfig();
  if (args.includes('--parear') || !CONF) {
    if (args.includes('--background') && !CONF) { log('Sem pareamento; execute "Conectar impressora" no menu Iniciar.'); return; }
    CONF = await parear();
    if (args.includes('--parear') && !args.includes('--continuar')) return;
  }
  // instância única
  await new Promise((resolve) => {
    const srv = net.createServer().once('error', () => { log('Já existe um programa de impressão aberto.'); process.exit(0); }).listen(47653, '127.0.0.1', resolve);
  });
  log(`Programa de impressão TapMenu ${VERSAO} iniciado — loja ${CONF.loja_nome || CONF.tenant_id}`);
  await ciclo();
  setInterval(ciclo, INTERVALO_MS);
  setTimeout(verificarAtualizacao, 60000);
  setInterval(verificarAtualizacao, 6 * 3600 * 1000);
}
principal();
