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
const CONFIG_LEILAO_PATH = path.join(DATA_DIR, "config_leilao.json");

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
// CONFIGURAÇÃO DE MENSAGEM DE LEILÃO POR GRUPO
// ============================================================
function loadConfigLeilao() {
  try {
    if (fs.existsSync(CONFIG_LEILAO_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_LEILAO_PATH, "utf8"));
    }
  } catch {}
  return {};
}

function saveConfigLeilao(data) {
  try {
    fs.writeFileSync(CONFIG_LEILAO_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao salvar config:", e.message);
  }
}

/**
 * Define a mensagem de pagamento personalizada para o grupo.
 */
export function setMsgPagamento(groupJid, mensagem) {
  const config = loadConfigLeilao();
  if (!config[groupJid]) config[groupJid] = {};
  config[groupJid].msgPagamento = mensagem;
  saveConfigLeilao(config);
  return true;
}

/**
 * Obtém a mensagem de pagamento do grupo (ou padrão).
 */
export function getMsgPagamento(groupJid) {
  const config = loadConfigLeilao();
  return config[groupJid]?.msgPagamento || "Procura o admin pra acertar o pagamento!";
}

/**
 * Define a mensagem inicial personalizada para o grupo.
 */
export function setMsgInicial(groupJid, mensagem) {
  const config = loadConfigLeilao();
  if (!config[groupJid]) config[groupJid] = {};
  config[groupJid].msgInicial = mensagem;
  saveConfigLeilao(config);
  return true;
}

/**
 * Obtém a mensagem inicial do grupo (ou padrão).
 */
export function getMsgInicial(groupJid) {
  const config = loadConfigLeilao();
  return config[groupJid]?.msgInicial || "";
}

/**
 * Retorna a config completa do grupo.
 */
export function getConfigLeilao(groupJid) {
  const config = loadConfigLeilao();
  return config[groupJid] || {};
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
    proximoItem: 1, // Contador para numeração automática
  };

  saveLeiloes(db);
  console.log(`✅ [LEILÃO] Sessão iniciada no grupo ${groupJid} por ${adminJid}`);
  return { ok: true };
}

/**
 * Registra uma nova enquete dentro da sessão ativa.
 * @param {string} valorFixo - Valor opcional para enquetes Sim/Não (enquete-c)
 */
export function registrarEnquete(groupJid, pollMsgId, descricao, opcoes, valorFixo = null) {
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

  const numeroItem = sessao.proximoItem || 1;
  const descricaoComNumero = `Item #${numeroItem} - ${descricao}`;
  
  sessao.enquetes[pollMsgId] = {
    numero: numeroItem,
    descricao: descricaoComNumero,
    opcoes: opcoesComHash,
    votos: {},
    encerrada: false,
    vencedor: null,
    valorVencedor: null,
    valorFixo: valorFixo ? extrairValorNumerico(valorFixo) : null,
    criadaEm: new Date().toISOString(),
  };

  sessao.proximoItem = numeroItem + 1;

  saveLeiloes(db);
  console.log(`📝 [LEILÃO] Enquete registrada: "${descricao}" (ID: ${pollMsgId}) ${valorFixo ? `[Valor Fixo: ${valorFixo}]` : ""}`);
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
 * 
 * CORREÇÃO SESSÃO CRUZADA: Agora valida ESTRITAMENTE que o groupJid
 * corresponde à sessão correta. Não busca mais em "qualquer sessão".
 */
export function registrarVotoFallback(groupJid, pollMsgId, voterJid, selectedOptionHashes) {
  const db = loadLeiloes();

  // CORREÇÃO: Buscar APENAS no grupo correto primeiro
  if (groupJid) {
    const sessao = db.sessoes[groupJid];
    if (sessao && sessao.status === "ativo" && sessao.enquetes[pollMsgId]) {
      return registrarVotoFallbackInterno(db, groupJid, pollMsgId, voterJid, selectedOptionHashes);
    }
  }

  // Fallback: buscar em outras sessões APENAS pelo pollMsgId
  // (necessário porque o groupJid pode vir errado do Baileys)
  for (const [gJid, s] of Object.entries(db.sessoes)) {
    if (s.status === "ativo" && s.enquetes[pollMsgId]) {
      console.log(`🔄 [LEILÃO] Voto redirecionado: grupo informado ${groupJid} → grupo correto ${gJid}`);
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
    let votosComValor = votos.map(([voterJid, votoData]) => {
      const opcaoTexto = typeof votoData === "string" ? votoData : votoData.opcaoTexto;
      const valor = extrairValorNumerico(opcaoTexto);
      const timestamp = typeof votoData === "object" ? votoData.timestamp || 0 : 0;
      return { voterJid, opcaoTexto, valor, timestamp };
    });

    // REGRA ESPECIAL PARA ENQUETE-S (Sim/Não)
    const isEnqueteS = enquete.opcoes.length === 2 && 
                       enquete.opcoes.some(o => o.texto === "Sim") && 
                       enquete.opcoes.some(o => o.texto === "Não");

    if (isEnqueteS) {
      // Filtra apenas quem votou "Sim"
      votosComValor = votosComValor.filter(v => v.opcaoTexto === "Sim");
      
      if (votosComValor.length === 0) {
        itensSemLance.push(enquete.descricao);
        enquete.encerrada = true;
        continue;
      }

      // No !enquete-s, quem votou primeiro ganha (menor timestamp)
      votosComValor.sort((a, b) => a.timestamp - b.timestamp);
    } else {
      // Ordenar leilão normal: maior valor primeiro; em caso de empate, menor timestamp
      votosComValor.sort((a, b) => {
        if (b.valor !== a.valor) return b.valor - a.valor;
        return a.timestamp - b.timestamp;
      });
    }

    const vencedor = votosComValor[0];
    enquete.encerrada = true;
    enquete.vencedor = vencedor.voterJid;
    
    // Se tiver valor fixo (enquete-c), usa ele. Senão usa o valor extraído da opção.
    const valorFinal = (enquete.valorFixo !== undefined && enquete.valorFixo !== null) ? enquete.valorFixo : vencedor.valor;
    enquete.valorVencedor = valorFinal;

    resultados.push({
      descricao: enquete.descricao,
      vencedorJid: vencedor.voterJid,
      vencedorNumero: vencedor.voterJid.replace(/@.*/, ""),
      valorTexto: (enquete.valorFixo !== undefined && enquete.valorFixo !== null) ? formatarReais(enquete.valorFixo) : vencedor.opcaoTexto,
      valorNumerico: valorFinal,
      totalVotos: votos.length,
      isEnqueteS // Flag para o relatório saber que é brinde/sim-não
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
      valor: valorFinal,
      valorTexto: (enquete.valorFixo !== undefined && enquete.valorFixo !== null) ? formatarReais(enquete.valorFixo) : vencedor.opcaoTexto,
    });
    comprasPorPessoa[vencedor.voterJid].total += valorFinal;
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
// DELAY HUMANIZADO — Simula comportamento humano
// ============================================================

/**
 * Gera um delay aleatório entre min e max milissegundos.
 */
export function delayHumano(minMs = 800, maxMs = 2500) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay longo entre blocos de envio (30 a 50 segundos).
 */
export function delayEntreBloco() {
  const minSeg = 30;
  const maxSeg = 50;
  const ms = Math.floor(Math.random() * ((maxSeg - minSeg) * 1000 + 1)) + (minSeg * 1000);
  console.log(`⏳ [LEILÃO] Aguardando ${(ms / 1000).toFixed(1)}s antes do próximo bloco...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// GERAÇÃO DE RELATÓRIOS (TEXTO) — FORMATO HUMANIZADO
// ============================================================

/**
 * Gera a mensagem de anúncio público para o grupo.
 * Envia em BLOCOS de até 5 itens para parecer humano.
 */
export function gerarAnuncioGrupoBlocos(dadosEncerramento) {
  const { resultados, itensSemLance } = dadosEncerramento;

  if (resultados.length === 0 && itensSemLance.length === 0) {
    return [{
      texto: "🔨 *LEILÃO ENCERRADO!* 🔨\n\nNenhum item recebeu lance. Que vacilo, galera!",
      mentions: [],
    }];
  }

  const blocos = [];
  const TAMANHO_BLOCO = 5;

  // Bloco de abertura
  blocos.push({
    texto: `🔨 *LEILÃO ENCERRADO!* 🔨\n\n📦 *${resultados.length}* itens arrematados | ❌ *${itensSemLance.length}* sem lance\n\nConfira os resultados:`,
    mentions: [],
  });

  // Blocos de resultados (5 itens por bloco)
  for (let i = 0; i < resultados.length; i += TAMANHO_BLOCO) {
    const bloco = resultados.slice(i, i + TAMANHO_BLOCO);
    let texto = "";
    const mentions = [];

    for (const r of bloco) {
      texto += `📦 *${r.descricao}*\n`;
      texto += `💰 ${r.valorTexto} — 🏆 @${r.vencedorNumero}\n\n`;
      if (!mentions.includes(r.vencedorJid)) {
        mentions.push(r.vencedorJid);
      }
    }

    blocos.push({ texto: texto.trim(), mentions });
  }

  // Bloco de itens sem lance (se houver)
  if (itensSemLance.length > 0) {
    let texto = "❌ *Itens sem lance:*\n";
    for (const item of itensSemLance) {
      texto += `  • ${item}\n`;
    }
    blocos.push({ texto: texto.trim(), mentions: [] });
  }

  // Bloco final
  blocos.push({
    texto: "Relatórios individuais enviados no PV! 📩",
    mentions: [],
  });

  return blocos;
}

/**
 * Gera a mensagem de relatório individual para o comprador (PV).
 * Usa a mensagem de pagamento configurável.
 */
export function gerarRelatorioComprador(voterJid, compras, grupoNome, msgPagamento) {
  const msg = msgPagamento || "Procura o admin pra acertar o pagamento!";

  let texto = `🎉 Você arrematou itens no leilão do grupo *${grupoNome}*.\n\n`;
  texto += "Aqui tá o seu resumo:\n";

  compras.itens.forEach((item, i) => {
    texto += `${i + 1}. ${item.descricao} — ${item.valorTexto}\n`;
  });

  texto += `\n💵 *Total a pagar:* *${formatarReais(compras.total)}*\n\n`;
  texto += msg;

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
        // Se for enquete-s, o valorTexto é "Sim", mas no relatório fica mais bonito mostrar apenas a descrição ou "Arrematado"
        const valorExibicao = item.valorTexto === "Sim" ? "Arrematado" : item.valorTexto;
        texto += `  ${item.descricao} — ${valorExibicao}\n`;
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

// ============================================================
// FUNÇÕES LEGADAS (mantidas para compatibilidade)
// ============================================================

/**
 * Gera anúncio de grupo em formato único (legado).
 */
export function gerarAnuncioGrupo(dadosEncerramento) {
  const blocos = gerarAnuncioGrupoBlocos(dadosEncerramento);
  // Junta tudo em uma mensagem só (fallback)
  const texto = blocos.map(b => b.texto).join("\n\n");
  const mentions = [...new Set(blocos.flatMap(b => b.mentions))];
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
  gerarAnuncioGrupoBlocos,
  gerarRelatorioComprador,
  gerarRelatorioAdmin,
  formatarReais,
  extrairValorNumerico,
  setMsgPagamento,
  getMsgPagamento,
  getConfigLeilao,
  delayHumano,
  delayEntreBloco,
};
// FIM leilaoManager.js
