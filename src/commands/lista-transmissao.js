// ============================================================
// lista-transmissao.js — Sistema de Listas de Transmissão para Parceiros
//
// Comandos (apenas PV + allowed):
//   !listar-grupos         → Lista todos os grupos do bot com nome e ID
//   !criar-lista nome id1 id2 ...  → Cria lista de transmissão
//   !ver-listas            → Lista as listas do usuário
//   !enviar-lista nome | mensagem  → Envia mensagem para todos os grupos da lista
//   !editar-lista nome +id1 -id2   → Adiciona/remove grupos da lista
//   !apagar-lista nome     → Remove uma lista
//
// Acesso: PV + ID presente em allowed.json (grupos ou privados)
// ============================================================

import fs from "fs";
import path from "path";
import { idsMatch } from "../utils/userMapper.js";

const AUTH_PATH = path.resolve("src/data/auth/allowed.json");
const LISTAS_PATH = path.resolve("src/data/listas_transmissao.json");

// ============================================================
// HELPERS
// ============================================================
function loadAuth() {
  return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
}

function loadListas() {
  if (!fs.existsSync(LISTAS_PATH)) {
    fs.writeFileSync(LISTAS_PATH, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(LISTAS_PATH, "utf8"));
}

function saveListas(data) {
  fs.writeFileSync(LISTAS_PATH, JSON.stringify(data, null, 2));
}

function normalizarId(raw) {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 15) digits = digits.slice(-15);
  return digits;
}

/**
 * Verifica se o usuário está no allowed.json (em qualquer grupo ou privados).
 * Retorna true se o ID está autorizado em pelo menos um lugar.
 * Usa comparação flexível para lidar com LID vs PN.
 */
function isAllowed(fromClean) {
  const db = loadAuth();
  const normalizado = normalizarId(fromClean);

  // Verificar ROOT via env
  const ROOT = process.env.ROOT_ID;
  if (ROOT && idsMatch(normalizado, ROOT)) return true;

  // Verificar em privados
  if (db.privados) {
    for (const privId of Object.keys(db.privados)) {
      if (idsMatch(normalizado, privId)) return true;
    }
  }

  // Verificar em qualquer grupo (como autorizado ou pagador)
  for (const grupoId of Object.keys(db.grupos || {})) {
    const grupo = db.grupos[grupoId];
    if (grupo.autorizados) {
      for (const autId of grupo.autorizados) {
        if (idsMatch(normalizado, autId)) return true;
      }
    }
    if (idsMatch(normalizado, grupo.pagador)) return true;
  }

  return false;
}

// ============================================================
// COMANDO: !listar-grupos
// Lista todos os grupos onde o bot está presente
// ============================================================
export async function comandoListarGrupos(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  try {
    // Buscar todos os grupos do bot
    const grupos = await sock.groupFetchAllParticipating();
    const gruposList = Object.values(grupos);

    if (gruposList.length === 0) {
      await sock.sendMessage(jid, { text: "📋 O bot não está em nenhum grupo." });
      return null;
    }

    // Ordenar por nome
    gruposList.sort((a, b) => (a.subject || "").localeCompare(b.subject || ""));

    // Montar a lista
    let texto = `📋 *GRUPOS DO BOT* (${gruposList.length} grupos)\n`;
    texto += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const grupo of gruposList) {
      const nome = grupo.subject || "Sem nome";
      const id = grupo.id;
      const membros = grupo.participants?.length || "?";
      texto += `📌 *${nome}*\n`;
      texto += `   ID: \`${id}\`\n`;
      texto += `   👥 ${membros} membros\n\n`;
    }

    // Dividir se muito grande
    const LIMITE = 4000;
    if (texto.length <= LIMITE) {
      await sock.sendMessage(jid, { text: texto });
    } else {
      // Enviar cabeçalho
      await sock.sendMessage(jid, { text: `📋 *GRUPOS DO BOT* (${gruposList.length} grupos)\n━━━━━━━━━━━━━━━━━━━━` });

      let bloco = "";
      for (const grupo of gruposList) {
        const nome = grupo.subject || "Sem nome";
        const id = grupo.id;
        const membros = grupo.participants?.length || "?";
        const entrada = `📌 *${nome}*\n   ID: \`${id}\`\n   👥 ${membros} membros\n\n`;

        if ((bloco + entrada).length > LIMITE) {
          await sock.sendMessage(jid, { text: bloco });
          await new Promise(r => setTimeout(r, 500));
          bloco = "";
        }
        bloco += entrada;
      }
      if (bloco) {
        await sock.sendMessage(jid, { text: bloco });
      }
    }

    console.log(`📋 [LISTAS] ${fromClean} listou ${gruposList.length} grupos`);
    return null;

  } catch (e) {
    console.error("[LISTAS] Erro ao listar grupos:", e.message);
    await sock.sendMessage(jid, { text: "❌ Erro ao buscar os grupos do bot." });
    return null;
  }
}

// ============================================================
// COMANDO: !criar-lista nome id1 id2 id3 ...
// Cria uma lista de transmissão para o usuário
// ============================================================
export async function comandoCriarListaTransmissao(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  // Pegar o texto completo do comando
  const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  // Formato: !criar-lista nome id1 id2 id3
  const partes = texto.replace(/^!criar-lista\s+/i, "").trim().split(/\s+/);

  if (partes.length < 2) {
    await sock.sendMessage(jid, {
      text: `❌ *Formato incorreto!*\n\nUse: *!criar-lista nome_da_lista id1 id2 id3*\n\nExemplo:\n!criar-lista parceiros 120363423975280243@g.us 120363425663755197@g.us\n\n💡 Use *!listar-grupos* para ver os IDs disponíveis.`
    });
    return null;
  }

  const nomeLista = partes[0].toLowerCase().trim();
  const grupoIds = partes.slice(1);

  // Validar nome da lista (sem caracteres especiais)
  if (!/^[a-z0-9_-]+$/i.test(nomeLista)) {
    await sock.sendMessage(jid, {
      text: "❌ O nome da lista deve conter apenas letras, números, _ ou -.\nExemplo: *parceiros*, *venda-pokemon*, *grupo_tcg*"
    });
    return null;
  }

  // Validar que os IDs são de grupos
  const idsValidos = [];
  const idsInvalidos = [];

  // Buscar grupos do bot para validar
  let gruposBot = {};
  try {
    gruposBot = await sock.groupFetchAllParticipating();
  } catch (e) {
    console.error("[LISTAS] Erro ao buscar grupos:", e.message);
  }

  for (const id of grupoIds) {
    // Aceitar com ou sem @g.us
    let idFormatado = id.trim();
    if (!idFormatado.endsWith("@g.us")) {
      idFormatado = idFormatado + "@g.us";
    }

    if (gruposBot[idFormatado]) {
      idsValidos.push({
        id: idFormatado,
        nome: gruposBot[idFormatado].subject || "Sem nome"
      });
    } else {
      idsInvalidos.push(id);
    }
  }

  if (idsValidos.length === 0) {
    await sock.sendMessage(jid, {
      text: `❌ Nenhum dos IDs informados é válido ou o bot não está nesses grupos.\n\n💡 Use *!listar-grupos* para ver os IDs disponíveis.`
    });
    return null;
  }

  // Salvar a lista
  const userId = normalizarId(fromClean);
  const db = loadListas();

  if (!db[userId]) {
    db[userId] = {};
  }

  db[userId][nomeLista] = {
    nome: nomeLista,
    grupos: idsValidos.map(g => ({ id: g.id, nome: g.nome })),
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };

  saveListas(db);

  // Montar resposta
  let resposta = `✅ *Lista "${nomeLista}" criada com sucesso!*\n\n`;
  resposta += `📋 *Grupos na lista:*\n`;
  for (const g of idsValidos) {
    resposta += `  ✅ ${g.nome}\n`;
  }

  if (idsInvalidos.length > 0) {
    resposta += `\n⚠️ *IDs não encontrados (ignorados):*\n`;
    for (const id of idsInvalidos) {
      resposta += `  ❌ ${id}\n`;
    }
  }

  resposta += `\n💡 Use *!enviar-lista ${nomeLista} | sua mensagem* para enviar.`;

  await sock.sendMessage(jid, { text: resposta });
  console.log(`📋 [LISTAS] ${fromClean} criou lista "${nomeLista}" com ${idsValidos.length} grupos`);
  return null;
}

// ============================================================
// COMANDO: !ver-listas
// Lista todas as listas de transmissão do usuário
// ============================================================
export async function comandoVerListas(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  const userId = normalizarId(fromClean);
  const db = loadListas();

  if (!db[userId] || Object.keys(db[userId]).length === 0) {
    await sock.sendMessage(jid, {
      text: `📋 Você não tem nenhuma lista de transmissão.\n\n💡 Use *!criar-lista nome id1 id2* para criar uma.`
    });
    return null;
  }

  const listas = db[userId];
  let texto = `📋 *SUAS LISTAS DE TRANSMISSÃO*\n`;
  texto += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const [nome, lista] of Object.entries(listas)) {
    texto += `📌 *${nome}*\n`;
    texto += `   📦 ${lista.grupos.length} grupo(s)\n`;
    for (const g of lista.grupos) {
      texto += `   • ${g.nome}\n`;
    }
    texto += `   📅 Criada: ${new Date(lista.criadoEm).toLocaleDateString("pt-BR")}\n\n`;
  }

  texto += `━━━━━━━━━━━━━━━━━━━━\n`;
  texto += `💡 *Comandos:*\n`;
  texto += `• *!enviar-lista nome | mensagem* → Enviar\n`;
  texto += `• *!editar-lista nome +id -id* → Editar\n`;
  texto += `• *!apagar-lista nome* → Remover`;

  await sock.sendMessage(jid, { text: texto });
  return null;
}

// ============================================================
// COMANDO: !enviar-lista nome | mensagem
// Envia uma mensagem para todos os grupos da lista
// ============================================================
export async function comandoEnviarLista(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  // Pegar o texto completo
  const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  // Formato: !enviar-lista nome | mensagem
  const conteudo = texto.replace(/^!enviar-lista\s+/i, "").trim();
  const separadorIdx = conteudo.indexOf("|");

  if (separadorIdx === -1) {
    await sock.sendMessage(jid, {
      text: `❌ *Formato incorreto!*\n\nUse: *!enviar-lista nome_da_lista | sua mensagem*\n\nExemplo:\n!enviar-lista parceiros | 🔥 Promoção especial! Confira nosso link...`
    });
    return null;
  }

  const nomeLista = conteudo.substring(0, separadorIdx).trim().toLowerCase();
  const mensagem = conteudo.substring(separadorIdx + 1).trim();

  if (!mensagem) {
    await sock.sendMessage(jid, { text: "❌ A mensagem não pode estar vazia." });
    return null;
  }

  // Buscar a lista
  const userId = normalizarId(fromClean);
  const db = loadListas();

  if (!db[userId] || !db[userId][nomeLista]) {
    await sock.sendMessage(jid, {
      text: `❌ Lista "${nomeLista}" não encontrada.\n\n💡 Use *!ver-listas* para ver suas listas.`
    });
    return null;
  }

  const lista = db[userId][nomeLista];
  const grupos = lista.grupos;

  if (grupos.length === 0) {
    await sock.sendMessage(jid, { text: `❌ A lista "${nomeLista}" está vazia.` });
    return null;
  }

  // Enviar confirmação antes
  await sock.sendMessage(jid, {
    text: `📤 *Enviando para ${grupos.length} grupo(s) da lista "${nomeLista}"...*`
  });

  // Verificar se tem imagem anexada (reply com imagem ou imagem direta)
  const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const hasImage = quotedMsg?.imageMessage || msg.message?.imageMessage;

  let enviados = 0;
  let falhas = 0;
  const erros = [];

  for (const grupo of grupos) {
    try {
      if (hasImage) {
        // Se tem imagem, reencaminhar com a mensagem como legenda
        const imageMsg = quotedMsg?.imageMessage || msg.message?.imageMessage;
        await sock.sendMessage(grupo.id, {
          image: { url: imageMsg.url },
          caption: mensagem,
          mimetype: imageMsg.mimetype || "image/jpeg"
        });
      } else {
        await sock.sendMessage(grupo.id, { text: mensagem });
      }
      enviados++;
      // Delay anti-flood
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      falhas++;
      erros.push(`${grupo.nome}: ${e.message}`);
      console.error(`[LISTAS] Erro ao enviar para ${grupo.nome} (${grupo.id}):`, e.message);
    }
  }

  // Relatório de envio
  let relatorio = `📊 *RELATÓRIO DE ENVIO*\n`;
  relatorio += `━━━━━━━━━━━━━━━━━━━━\n`;
  relatorio += `📋 Lista: *${nomeLista}*\n`;
  relatorio += `✅ Enviados: *${enviados}/${grupos.length}*\n`;

  if (falhas > 0) {
    relatorio += `❌ Falhas: *${falhas}*\n\n`;
    relatorio += `⚠️ *Erros:*\n`;
    for (const erro of erros) {
      relatorio += `  • ${erro}\n`;
    }
  } else {
    relatorio += `\n🎉 Todos os envios foram bem-sucedidos!`;
  }

  await sock.sendMessage(jid, { text: relatorio });
  console.log(`📤 [LISTAS] ${fromClean} enviou para lista "${nomeLista}": ${enviados}/${grupos.length} OK`);
  return null;
}

// ============================================================
// COMANDO: !editar-lista nome +id1 -id2
// Adiciona (+) ou remove (-) grupos de uma lista
// ============================================================
export async function comandoEditarLista(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  const conteudo = texto.replace(/^!editar-lista\s+/i, "").trim();
  const partes = conteudo.split(/\s+/);

  if (partes.length < 2) {
    await sock.sendMessage(jid, {
      text: `❌ *Formato incorreto!*\n\nUse: *!editar-lista nome +id_grupo -id_grupo*\n\nExemplo:\n!editar-lista parceiros +120363423975280243@g.us -120363425663755197@g.us\n\n• *+id* para adicionar grupo\n• *-id* para remover grupo`
    });
    return null;
  }

  const nomeLista = partes[0].toLowerCase().trim();
  const operacoes = partes.slice(1);

  const userId = normalizarId(fromClean);
  const db = loadListas();

  if (!db[userId] || !db[userId][nomeLista]) {
    await sock.sendMessage(jid, {
      text: `❌ Lista "${nomeLista}" não encontrada.\n\n💡 Use *!ver-listas* para ver suas listas.`
    });
    return null;
  }

  // Buscar grupos do bot para validar adições
  let gruposBot = {};
  try {
    gruposBot = await sock.groupFetchAllParticipating();
  } catch (e) {
    console.error("[LISTAS] Erro ao buscar grupos:", e.message);
  }

  const lista = db[userId][nomeLista];
  const adicionados = [];
  const removidos = [];
  const erros = [];

  for (const op of operacoes) {
    const acao = op.charAt(0);
    let idGrupo = op.substring(1).trim();

    if (!idGrupo.endsWith("@g.us")) {
      idGrupo = idGrupo + "@g.us";
    }

    if (acao === "+") {
      // Adicionar
      if (lista.grupos.some(g => g.id === idGrupo)) {
        erros.push(`${idGrupo} já está na lista`);
        continue;
      }
      if (gruposBot[idGrupo]) {
        lista.grupos.push({
          id: idGrupo,
          nome: gruposBot[idGrupo].subject || "Sem nome"
        });
        adicionados.push(gruposBot[idGrupo].subject || idGrupo);
      } else {
        erros.push(`${idGrupo} não encontrado`);
      }
    } else if (acao === "-") {
      // Remover
      const antes = lista.grupos.length;
      lista.grupos = lista.grupos.filter(g => g.id !== idGrupo);
      if (lista.grupos.length < antes) {
        removidos.push(idGrupo);
      } else {
        erros.push(`${idGrupo} não estava na lista`);
      }
    } else {
      erros.push(`Operação inválida: ${op} (use +id ou -id)`);
    }
  }

  lista.atualizadoEm = new Date().toISOString();
  saveListas(db);

  // Montar resposta
  let resposta = `✅ *Lista "${nomeLista}" atualizada!*\n\n`;

  if (adicionados.length > 0) {
    resposta += `➕ *Adicionados:*\n`;
    for (const a of adicionados) resposta += `  • ${a}\n`;
    resposta += `\n`;
  }

  if (removidos.length > 0) {
    resposta += `➖ *Removidos:*\n`;
    for (const r of removidos) resposta += `  • ${r}\n`;
    resposta += `\n`;
  }

  if (erros.length > 0) {
    resposta += `⚠️ *Avisos:*\n`;
    for (const e of erros) resposta += `  • ${e}\n`;
    resposta += `\n`;
  }

  resposta += `📦 Total de grupos na lista: *${lista.grupos.length}*`;

  await sock.sendMessage(jid, { text: resposta });
  console.log(`📋 [LISTAS] ${fromClean} editou lista "${nomeLista}": +${adicionados.length} -${removidos.length}`);
  return null;
}

// ============================================================
// COMANDO: !apagar-lista nome
// Remove uma lista de transmissão
// ============================================================
export async function comandoApagarLista(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  // Apenas PV
  if (jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "❌ Este comando funciona apenas no PV do bot." });
    return null;
  }

  // Verificar allowed
  if (!isAllowed(fromClean)) {
    await sock.sendMessage(jid, { text: "❌ Você não tem permissão para usar este comando." });
    return null;
  }

  const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  const nomeLista = texto.replace(/^!apagar-lista\s+/i, "").trim().toLowerCase();

  if (!nomeLista) {
    await sock.sendMessage(jid, {
      text: `❌ *Formato incorreto!*\n\nUse: *!apagar-lista nome_da_lista*`
    });
    return null;
  }

  const userId = normalizarId(fromClean);
  const db = loadListas();

  if (!db[userId] || !db[userId][nomeLista]) {
    await sock.sendMessage(jid, {
      text: `❌ Lista "${nomeLista}" não encontrada.\n\n💡 Use *!ver-listas* para ver suas listas.`
    });
    return null;
  }

  const totalGrupos = db[userId][nomeLista].grupos.length;
  delete db[userId][nomeLista];

  // Limpar usuário se não tem mais listas
  if (Object.keys(db[userId]).length === 0) {
    delete db[userId];
  }

  saveListas(db);

  await sock.sendMessage(jid, {
    text: `🗑️ Lista *"${nomeLista}"* removida com sucesso!\n(${totalGrupos} grupo(s) desvinculados)`
  });

  console.log(`🗑️ [LISTAS] ${fromClean} apagou lista "${nomeLista}"`);
  return null;
}

// ============================================================
// FIM lista-transmissao.js
// ============================================================
