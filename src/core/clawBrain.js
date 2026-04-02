// INÍCIO clawBrain.js — Motor Central de Resposta

import fs from "fs";
import path from "path";
import { aiGenerateReply_Unique01 } from "./aiClient.js";
import { executarAcoesAutomaticas_Unique01 } from "../actions/index.js";
import { isFriend, setFriend } from "./friendManager.js";

// ------------------ UTIL ------------------
function compactarResposta_Unique01(t) {
  if (!t) return "";
  return t
    .replace(/@\d+/g, "")
    .replace(/<@\d+>/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------ MENSAGENS DE ERRO NATURAIS ------------------
// Mapa de motivos de erro para respostas humanizadas e diretas
const ERROS_HUMANIZADOS = {
  nao_grupo: "Esse comando só funciona em grupos.",
  formato_invalido: "Formato inválido. Verifique o comando e tente de novo.",
  falha_expulsao: "Não consegui remover o usuário. Verifique se sou admin do grupo.",
  falha_remocao: "Falha ao remover da lista. Tente novamente.",
  nao_existe: "Esse usuário não está na lista de banidos.",
  sem_permissao: "Você não tem permissão para isso.",
  nao_autorizado: "Você não está autorizado a usar esse comando neste grupo.",
  grupo_sem_autorizacao: "Este grupo não está autorizado para usar o bot.",
  mensagem_vazia: "Você precisa informar a mensagem. Ex: !cadastro-all Sua mensagem aqui",
  nao_root: "Apenas o administrador principal pode usar este comando.",
  id_invalido: "ID inválido. Informe um número válido.",
  id_nao_encontrado: "Lembrete não encontrado com esse ID.",
};

function resolverErro(motivo) {
  return ERROS_HUMANIZADOS[motivo] || "Algo deu errado. Tente de novo.";
}

// ------------------ SISTEMA PV ------------------
async function verificarSistemaPV(msgObj) {

  const jid = msgObj?.key?.remoteJid;
  if (!jid || jid.endsWith("@g.us")) return null;

  const raw = msgObj?.key?.participant || jid;
  const fromClean = raw.replace(/@.*/, "");

  const texto =
    msgObj?.message?.conversation ||
    msgObj?.message?.extendedTextMessage?.text ||
    "";

  const textoLower = texto.toLowerCase();

  const bansPath = path.resolve("src/data/bans.json");

  if (fs.existsSync(bansPath)) {
    const bansDB = JSON.parse(fs.readFileSync(bansPath, "utf8"));
    const banGlobal = bansDB.global?.find(b => b.alvo === fromClean);

    if (banGlobal) {
      return "Seu acesso foi bloqueado. Fale com a administração.";
    }
  }

  if (textoLower.includes("sou de menor")) {
    return "Protocolo de segurança ativado.";
  }

  return null;
}

// ------------------ IA NORMAL ------------------
async function processarIANormal(msgObj) {

  const texto =
    msgObj?.message?.conversation ||
    msgObj?.message?.extendedTextMessage?.text ||
    "";

  const jid = msgObj?.key?.remoteJid;
  if (!jid || !texto) return "";

  if (texto.toLowerCase().includes("amigo")) {
    setFriend(jid);
    return "Registro confirmado.";
  }

  const acao = await executarAcoesAutomaticas_Unique01(texto, jid);
  if (acao) return compactarResposta_Unique01(acao);

  const r = await aiGenerateReply_Unique01(texto);
  return compactarResposta_Unique01(r);
}

// ------------------ CENTRAL ------------------
export async function clawBrainProcess_Unique01(msgObj) {

  // 1) Sistema PV tem prioridade
  const sistemaPV = await verificarSistemaPV(msgObj);
  if (sistemaPV) return sistemaPV;

  // 2) COMANDOS — retorno direto, sem passar pela IA desnecessariamente
  if (msgObj?.tipo === "comando" && msgObj?.comando) {

    const dados = msgObj?.dados || {};

    // Resposta já formatada como string
    if (typeof dados === "string") return dados;

    // Campos de resposta em ordem de prioridade
    if (dados?.mensagem) return dados.mensagem;
    if (dados?.texto) return dados.texto;
    if (dados?.resposta) return dados.resposta;
    if (dados?.anuncioIA) return dados.anuncioIA;
    if (dados?.despedida) return dados.despedida;

    // Erro com motivo mapeado → resposta humanizada direta
    if (dados?.status === "erro" && dados?.motivo) return resolverErro(dados.motivo);
    if (dados?.motivo && dados?.status !== "ok") return resolverErro(dados.motivo);

    // Comando executado com sucesso sem mensagem específica → não enviar nada extra
    if (dados?.status === "ok") return null;

    // Fallback neutro e natural
    return "Feito.";
  }

  // 3) Conversa normal
  return await processarIANormal(msgObj);
}

// FIM clawBrain.js
