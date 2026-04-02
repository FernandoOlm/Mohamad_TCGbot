// INÍCIO leilaoManager.js — Gerenciador de Sessões de Leilão
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");

const LEILOES_PATH = path.join(DATA_DIR, "leiloes_ativos.json");
const HISTORICO_PATH = path.join(DATA_DIR, "historico_leiloes.json");
const MESSAGE_STORE_PATH = path.join(DATA_DIR, "message_store.json");

// ============================================================
// MESSAGE STORE — Armazena mensagens de poll para decryption
// ============================================================
const messageStoreMemory = new Map();

/**
 * Armazena uma mensagem no store (memória + disco).
 * Essencial para o getAggregateVotesInPollMessage funcionar.
 */
export function storeMessage(msg) {
  if (!msg?.key?.remoteJid || !msg?.key?.id) return;
  const storeKey = msg.key.remoteJid + ":" + msg.key.id;
  messageStoreMemory.set(storeKey, msg);

  // Persistir no disco para sobreviver a restarts
  try {
    const store = loadMessageStore();
    store[storeKey] = msg;
    // Limitar tamanho: manter apenas as últimas 500 mensagens
    const keys = Object.keys(store);
    if (keys.length > 500) {
      const toRemove = keys.slice(0, keys.length - 500);
      toRemove.forEach((k) => delete store[k]);
    }
    fs.writeFileSync(MESSAGE_STORE_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("⚠️ [LEILÃO] Erro ao persistir messageStore:", e.message);
  }
}

/**
 * Recupera uma mensagem do store.
 * Usado como callback getMessage no socket do Baileys.
 */
export function getStoredMessage(key) {
  if (!key?.remoteJid || !key?.id) return undefined;
  const storeKey = key.remoteJid + ":" + key.id;

  // Tenta memória primeiro
  let msg = messageStoreMemory.get(storeKey);
  if (msg) return msg;

  // Fallback: disco
  try {
    const store = loadMessageStore();
    msg = store[storeKey];
    if (msg) {
      messageStoreMemory.set(storeKey, msg);
    }
    return msg || undefined;
  } catch {
    return undefined;
  }
}

function loadMessageStore() {
  try {
    if (fs.existsSync(MESSAGE_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(MESSAGE_STORE_PATH, "utf8"));
    }
  } catch {}
  return {};
}

// ============================================================
// PERSISTÊNCIA DE SESSÕES DE LEILÃO
// ============================================================
function ensureLeiloesFile() {
  if (!fs.existsSync(LEILOES_PATH)) {
    fs.writeFileSync(LEILOES_PATH, JSON.stringify({ sessoes: {} }, null, 2));
  }
}

function loadLeiloes() {
  ensureLeiloesFile();
  try {
    const raw = fs.readFileSync(LEILOES_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { sessoes: {} };
  }
}

function saveLeiloes(data) {
  try {
    fs.writeFileSync(LEILOES_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao salvar leilões:", e.message);
  }
}

function ensureHistoricoFile() {
  if (!fs.existsSync(HISTORICO_PATH)) {
    fs.writeFileSync(HISTORICO_PATH, JSON.stringify({ historico: [] }, null, 2));
  }
}

function loadHistorico() {
  ensureHistoricoFile();
  try {
    const raw = fs.readFileSync(HISTORICO_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { historico: [] };
  }
}

function saveHistorico(data) {
  try {
    fs.writeFileSync(HISTORICO_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao salvar histórico:", e.message);
  }
}

// ============================================================
// HASH DE OPÇÕES — Para fallback de mapeamento
// ============================================================
/**
 * Calcula o SHA-256 de uma opção (padrão Baileys).
 */
export function computeOptionHash(optionText) {
  return crypto.createHash("sha256").update(Buffer.from(optionText)).digest("hex");
}

// ============================================================
// FUNÇÕES DE SESSÃO
// ============================================================

/**
 * Verifica se há uma sessão de leilão ativa no grupo.
 */
export function temSessaoAtiva(groupJid) {
  const db = loadLeiloes();
  return db.sessoes[groupJid]?.status === "ativo";
}

/**
 * Retorna a sessão ativa do grupo (ou null).
 */
export function getSessaoAtiva(groupJid) {
  const db = loadLeiloes();
  const sessao = db.sessoes[groupJid];
  if (sessao && sessao.status === "ativo") return sessao;
  return null;
}

/**
 * Inicia uma nova sessão de leilão no grupo.
 */
export function iniciarSessao(groupJid, adminJid) {
  const db = loadLeiloes();

  if (db.sessoes[groupJid]?.status === "ativo") {
    return { ok: false, motivo: "ja_ativo" };
  }

  db.sessoes[groupJid] = {
    status: "ativo",
    iniciadoEm: new Date().toISOString(),
    iniciadoPor: adminJid,
    enquetes: {},
    comprasConsolidadas: {},
  };

  saveLeiloes(db);
  console.log(`✅ [LEILÃO] Sessão iniciada no grupo ${groupJid} por ${adminJid}`);
  return { ok: true };
}

/**
 * Registra uma nova enquete dentro da sessão ativa.
 */
export function registrarEnquete(groupJid, pollMsgId, descricao, opcoes) {
  const db = loadLeiloes();
  const sessao = db.sessoes[groupJid];

  if (!sessao || sessao.status !== "ativo") {
    return { ok: false, motivo: "sem_sessao" };
  }

  // Calcular hashes das opções para fallback
  const opcoesComHash = opcoes.map((texto) => ({
    texto,
    hash: computeOptionHash(texto),
  }));

  sessao.enquetes[pollMsgId] = {
    descricao,
    opcoes: opcoesComHash,
    votos: {},
    encerrada: false,
    vencedor: null,
    valorVencedor: null,
    criadaEm: new Date().toISOString(),
  };

  saveLeiloes(db);
  console.log(`📝 [LEILÃO] Enquete registrada: "${descricao}" (ID: ${pollMsgId})`);
  return { ok: true };
}

/**
 * Registra votos descriptografados (via getAggregateVotesInPollMessage).
 * Recebe o resultado agregado: { "Opção": { voters: [...], count: N } }
 */
export function registrarVotosAgregados(groupJid, pollMsgId, votesAgregados) {
  const db = loadLeiloes();
  const sessao = db.sessoes[groupJid];
  if (!sessao || sessao.status !== "ativo") return false;

  // Procura a enquete pelo ID exato
  const enquete = sessao.enquetes[pollMsgId];
  if (!enquete || enquete.encerrada) return false;

  // Limpa votos anteriores e reconstrói a partir dos dados agregados
  enquete.votos = {};

  for (const [opcaoTexto, dados] of Object.entries(votesAgregados)) {
    if (dados.voters && dados.voters.length > 0) {
      for (const voterJid of dados.voters) {
        enquete.votos[voterJid] = {
          opcaoTexto,
          timestamp: Date.now(),
        };
      }
    }
  }

  saveLeiloes(db);
  console.log(`✅ [LEILÃO] Votos agregados registrados para enquete ${pollMsgId}: ${Object.keys(enquete.votos).length} voto(s)`);
  return true;
}

/**
 * Registra um voto individual via fallback (hash bruto).
 * Usado quando getAggregateVotesInPollMessage não funciona.
 */
export function registrarVotoFallback(groupJid, pollMsgId, voterJid, selectedOptionHashes) {
  const db = loadLeiloes();

  // Se groupJid foi passado, tenta direto
  if (groupJid) {
    const sessao = db.sessoes[groupJid];
    if (sessao && sessao.status === "ativo" && sessao.enquetes[pollMsgId]) {
      return registrarVotoFallbackInterno(db, groupJid, pollMsgId, voterJid, selectedOptionHashes);
    }
  }

  // Tenta achar em qualquer sessão ativa
  for (const [gJid, s] of Object.entries(db.sessoes)) {
    if (s.status === "ativo" && s.enquetes[pollMsgId]) {
      return registrarVotoFallbackInterno(db, gJid, pollMsgId, voterJid, selectedOptionHashes);
    }
  }

  console.log(`⚠️ [LEILÃO] Voto ignorado: nenhuma sessão ativa com enquete ${pollMsgId}`);
  return false;
}

function registrarVotoFallbackInterno(db, groupJid, pollMsgId, voterJid, selectedOptionHashes) {
  const sessao = db.sessoes[groupJid];
  const enquete = sessao.enquetes[pollMsgId];
  if (!enquete || enquete.encerrada) return false;

  if (!selectedOptionHashes || selectedOptionHashes.length === 0) {
    // Voto removido
    delete enquete.votos[voterJid];
    saveLeiloes(db);
    console.log(`🗑️ [LEILÃO] Voto de ${voterJid} removido da enquete ${pollMsgId}`);
    return true;
  }

  // Tenta mapear o hash para o texto da opção
  const hashRecebido = Buffer.isBuffer(selectedOptionHashes[0])
    ? selectedOptionHashes[0].toString("hex")
    : typeof selectedOptionHashes[0] === "string"
      ? selectedOptionHashes[0]
      : "";

  let opcaoTexto = null;
  for (const opcao of enquete.opcoes) {
    if (opcao.hash === hashRecebido || opcao.hash.startsWith(hashRecebido) || hashRecebido.startsWith(opcao.hash)) {
      opcaoTexto = opcao.texto;
      break;
    }
  }

  enquete.votos[voterJid] = {
    opcaoTexto: opcaoTexto || `hash:${hashRecebido}`,
    hashOriginal: hashRecebido,
    timestamp: Date.now(),
  };

  saveLeiloes(db);
  console.log(`✅ [LEILÃO] Voto fallback de ${voterJid}: ${opcaoTexto || hashRecebido}`);
  return true;
}

/**
 * Retorna o status da sessão ativa para exibição.
 */
export function getStatusSessao(groupJid) {
  const sessao = getSessaoAtiva(groupJid);
  if (!sessao) return null;

  const enquetes = Object.entries(sessao.enquetes);
  const totalEnquetes = enquetes.length;
  const totalVotos = enquetes.reduce((acc, [, e]) => acc + Object.keys(e.votos).length, 0);

  const resumoEnquetes = enquetes.map(([id, e]) => {
    const numVotos = Object.keys(e.votos).length;
    return {
      descricao: e.descricao,
      numVotos,
      opcoes: e.opcoes.map((o) => o.texto),
    };
  });

  return {
    iniciadoEm: sessao.iniciadoEm,
    iniciadoPor: sessao.iniciadoPor,
    totalEnquetes,
    totalVotos,
    enquetes: resumoEnquetes,
  };
}

/**
 * Cancela a sessão sem gerar relatórios.
 */
export function cancelarSessao(groupJid) {
  const db = loadLeiloes();
  if (!db.sessoes[groupJid] || db.sessoes[groupJid].status !== "ativo") {
    return { ok: false, motivo: "sem_sessao" };
  }

  delete db.sessoes[groupJid];
  saveLeiloes(db);
  console.log(`🚫 [LEILÃO] Sessão cancelada no grupo ${groupJid}`);
  return { ok: true };
}

/**
 * Extrai o valor numérico de uma string de opção.
 * Suporta formatos: "R$ 10,00", "R$10", "10", "10.00", "R$ 10.50", etc.
 */
export function extrairValorNumerico(texto) {
  if (!texto || typeof texto !== "string") return 0;

  // Remove tudo exceto dígitos, vírgula e ponto
  let limpo = texto.replace(/[^\d.,]/g, "").trim();
  if (!limpo) return 0;

  // Se tem vírgula E ponto, assume formato brasileiro (1.000,50)
  if (limpo.includes(",") && limpo.includes(".")) {
    limpo = limpo.replace(/\./g, "").replace(",", ".");
  } else if (limpo.includes(",")) {
    // Só vírgula: assume decimal brasileiro (10,50)
    limpo = limpo.replace(",", ".");
  }

  const valor = parseFloat(limpo);
  return isNaN(valor) ? 0 : valor;
}

/**
 * Encerra a sessão de leilão, calcula vencedores e gera relatórios.
 * Retorna os dados necessários para enviar as mensagens.
 */
export function encerrarSessao(groupJid, grupoNome) {
  const db = loadLeiloes();
  const sessao = db.sessoes[groupJid];

  if (!sessao || sessao.status !== "ativo") {
    return { ok: false, motivo: "sem_sessao" };
  }

  const enquetes = Object.entries(sessao.enquetes);
  if (enquetes.length === 0) {
    delete db.sessoes[groupJid];
    saveLeiloes(db);
    return { ok: false, motivo: "sem_enquetes" };
  }

  const resultados = [];
  const comprasPorPessoa = {};
  const itensSemLance = [];

  for (const [pollId, enquete] of enquetes) {
    const votos = Object.entries(enquete.votos);

    if (votos.length === 0) {
      itensSemLance.push(enquete.descricao);
      enquete.encerrada = true;
      continue;
    }

    // Mapear votos com valores numéricos
    const votosComValor = votos.map(([voterJid, votoData]) => {
      const opcaoTexto = typeof votoData === "string" ? votoData : votoData.opcaoTexto;
      const valor = extrairValorNumerico(opcaoTexto);
      const timestamp = typeof votoData === "object" ? votoData.timestamp || 0 : 0;
      return { voterJid, opcaoTexto, valor, timestamp };
    });

    // Ordenar: maior valor primeiro; em caso de empate, menor timestamp (primeiro a votar)
    votosComValor.sort((a, b) => {
      if (b.valor !== a.valor) return b.valor - a.valor;
      return a.timestamp - b.timestamp;
    });

    const vencedor = votosComValor[0];
    enquete.encerrada = true;
    enquete.vencedor = vencedor.voterJid;
    enquete.valorVencedor = vencedor.valor;

    resultados.push({
      descricao: enquete.descricao,
      vencedorJid: vencedor.voterJid,
      vencedorNumero: vencedor.voterJid.replace(/@.*/, ""),
      valorTexto: vencedor.opcaoTexto,
      valorNumerico: vencedor.valor,
      totalVotos: votos.length,
    });

    // Consolidar compras por pessoa
    if (!comprasPorPessoa[vencedor.voterJid]) {
      comprasPorPessoa[vencedor.voterJid] = {
        itens: [],
        total: 0,
      };
    }
    comprasPorPessoa[vencedor.voterJid].itens.push({
      descricao: enquete.descricao,
      valor: vencedor.valor,
      valorTexto: vencedor.opcaoTexto,
    });
    comprasPorPessoa[vencedor.voterJid].total += vencedor.valor;
  }

  // Calcular faturamento total
  const faturamentoTotal = Object.values(comprasPorPessoa).reduce((acc, c) => acc + c.total, 0);

  // Mover para histórico
  const historico = loadHistorico();
  historico.historico.push({
    grupoJid: groupJid,
    grupoNome: grupoNome || "Grupo",
    iniciadoEm: sessao.iniciadoEm,
    encerradoEm: new Date().toISOString(),
    iniciadoPor: sessao.iniciadoPor,
    faturamentoTotal,
    totalItens: enquetes.length,
    itensVendidos: resultados.length,
    itensSemLance,
    resultados,
    comprasPorPessoa,
  });
  saveHistorico(historico);

  // Remover sessão ativa
  delete db.sessoes[groupJid];
  saveLeiloes(db);

  console.log(`🔨 [LEILÃO] Sessão encerrada no grupo ${groupJid}. Faturamento: R$ ${faturamentoTotal.toFixed(2)}`);

  return {
    ok: true,
    resultados,
    comprasPorPessoa,
    itensSemLance,
    faturamentoTotal,
    iniciadoEm: sessao.iniciadoEm,
    encerradoEm: new Date().toISOString(),
    iniciadoPor: sessao.iniciadoPor,
  };
}

/**
 * Formata o valor em reais.
 */
export function formatarReais(valor) {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

// ============================================================
// GERAÇÃO DE RELATÓRIOS (TEXTO)
// ============================================================

/**
 * Gera a mensagem de anúncio público para o grupo.
 */
export function gerarAnuncioGrupo(dadosEncerramento) {
  const { resultados, itensSemLance } = dadosEncerramento;

  if (resultados.length === 0) {
    return {
      texto: "🔨 *LEILÃO ENCERRADO!* 🔨\n\nNenhum item recebeu lance. Que vacilo, galera!",
      mentions: [],
    };
  }

  let texto = "🔨 *LEILÃO ENCERRADO!* 🔨\n\n";
  const mentions = [];

  for (const r of resultados) {
    texto += `📦 *Item:* ${r.descricao}\n`;
    texto += `💰 *Lance Vencedor:* ${r.valorTexto}\n`;
    texto += `🏆 *Ganhador:* @${r.vencedorNumero}\n\n`;
    if (!mentions.includes(r.vencedorJid)) {
      mentions.push(r.vencedorJid);
    }
  }

  if (itensSemLance.length > 0) {
    texto += "❌ *Itens sem lance:*\n";
    for (const item of itensSemLance) {
      texto += `  - ${item}\n`;
    }
    texto += "\n";
  }

  texto += "Relatórios individuais enviados no PV!";

  return { texto, mentions };
}

/**
 * Gera a mensagem de relatório individual para o comprador (PV).
 */
export function gerarRelatorioComprador(voterJid, compras, grupoNome) {
  let texto = `🎉 Você arrematou itens no leilão do grupo *${grupoNome}*.\n\n`;
  texto += "*Aqui tá o seu resumo:*\n";

  compras.itens.forEach((item, i) => {
    texto += `${i + 1}. ${item.descricao} — ${item.valorTexto}\n`;
  });

  texto += `\n💵 *Total a pagar:* *${formatarReais(compras.total)}*\n\n`;
  texto += "Procura o admin pra acertar o pagamento!";

  return texto;
}

/**
 * Gera o relatório consolidado para o administrador.
 */
export function gerarRelatorioAdmin(dadosEncerramento, grupoNome) {
  const { resultados, comprasPorPessoa, itensSemLance, faturamentoTotal, iniciadoEm, encerradoEm } = dadosEncerramento;

  const horaInicio = new Date(iniciadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const horaFim = new Date(encerradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  let texto = "📊 *RELATÓRIO DE LEILÃO ENCERRADO* 📊\n\n";
  texto += `📍 *Grupo:* ${grupoNome}\n`;
  texto += `🕒 *Duração:* ${horaInicio} às ${horaFim}\n`;
  texto += `📦 *Total de itens:* ${resultados.length + itensSemLance.length}\n`;
  texto += `✅ *Itens vendidos:* ${resultados.length}\n`;
  texto += `❌ *Itens sem lance:* ${itensSemLance.length}\n\n`;
  texto += `💰 *FATURAMENTO TOTAL:* *${formatarReais(faturamentoTotal)}*\n\n`;

  const mentions = [];

  if (Object.keys(comprasPorPessoa).length > 0) {
    texto += "━━━━━━━━━━━━━━━━━━━━\n";
    texto += "*RESUMO POR COMPRADOR:*\n";
    texto += "━━━━━━━━━━━━━━━━━━━━\n\n";

    for (const [voterJid, compras] of Object.entries(comprasPorPessoa)) {
      const numero = voterJid.replace(/@.*/, "");
      texto += `👤 *@${numero}*\n`;
      mentions.push(voterJid);

      for (const item of compras.itens) {
        texto += `  • ${item.descricao} (${item.valorTexto})\n`;
      }
      texto += `  *Subtotal:* ${formatarReais(compras.total)}\n\n`;
    }
  }

  if (itensSemLance.length > 0) {
    texto += "━━━━━━━━━━━━━━━━━━━━\n";
    texto += "*ITENS SEM LANCE:*\n";
    texto += "━━━━━━━━━━━━━━━━━━━━\n\n";
    for (const item of itensSemLance) {
      texto += `  • ${item}\n`;
    }
    texto += "\n";
  }

  texto += "Bom trabalho, chefe! 🚀";

  return { texto, mentions };
}

export default {
  storeMessage,
  getStoredMessage,
  computeOptionHash,
  temSessaoAtiva,
  getSessaoAtiva,
  iniciarSessao,
  registrarEnquete,
  registrarVotosAgregados,
  registrarVotoFallback,
  getStatusSessao,
  cancelarSessao,
  encerrarSessao,
  gerarAnuncioGrupo,
  gerarRelatorioComprador,
  gerarRelatorioAdmin,
  formatarReais,
  extrairValorNumerico,
};
// FIM leilaoManager.js
