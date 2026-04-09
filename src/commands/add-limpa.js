/* ---------------------------------------------------
   add-limpa.js — ADD + LIMPEZA + DEBUG PESADO
--------------------------------------------------- */

import fs from "fs";
import path from "path";
import { dbRun, dbGet } from "../core/database.js";

/* ---------------------------------------------------
   comando principal
--------------------------------------------------- */
export async function addLimpa(msg, sock) {
  console.log("🚀 [ADD-LIMPA] Comando recebido");

  try {
    const groupId = msg.key.remoteJid;
    console.log("📍 Grupo:", groupId);

    if (!groupId || !groupId.endsWith("@g.us")) {
      console.log("❌ Não é grupo");
      return;
    }

    const quoted =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
      console.log("❌ Não respondeu mensagem");
      return;
    }

    console.log("📥 Mensagem citada encontrada");

    let vcards = [];

    // 1 contato
    if (quoted.contactMessage?.vcard) {
      console.log("📇 1 vCard detectado");
      vcards.push(quoted.contactMessage.vcard);
    }

    // múltiplos
    if (quoted.contactsArrayMessage?.contacts) {
      console.log(
        `📇 ${quoted.contactsArrayMessage.contacts.length} contatos detectados`
      );

      for (const c of quoted.contactsArrayMessage.contacts) {
        if (c.vcard) vcards.push(c.vcard);
      }
    }

    if (!vcards.length) {
      console.log("❌ Nenhum vCard encontrado");
      return;
    }

    console.log("📦 Total de vcards:", vcards.length);

    /* ---------------------------------------------------
       EXTRAIR NÚMEROS
    --------------------------------------------------- */
    let numeros = [];

    for (const vcard of vcards) {
      const matches = vcard.match(/TEL[^:]*:(.+)/gi);

      if (!matches) continue;

      for (const linha of matches) {
        let numero = linha.split(":")[1];
        if (!numero) continue;

        numero = numero.replace(/\D/g, "");

        if (numero.length >= 10) {
          numeros.push(numero);
        }
      }
    }

    numeros = [...new Set(numeros)];

    console.log("📱 Números extraídos:", numeros.length);
    console.log(numeros);

    /* ---------------------------------------------------
       CONTADORES
    --------------------------------------------------- */
    let totalVcards = numeros.length;
    let existeWhats = 0;
    let naoExiste = 0;
    let jaBanido = 0;
    let addBan = 0;

    console.log("📚 Verificando bans no SQLite...");

    /* ---------------------------------------------------
       PROCESSAMENTO
    --------------------------------------------------- */
    for (const numero of numeros) {
      console.log("\n➡️ Processando:", numero);

      try {
        const jid = `${numero}@s.whatsapp.net`;

        // 🔍 verifica WhatsApp
        const check = await sock.onWhatsApp(jid);

        if (!check || !check.length) {
          console.log("❌ Não tem WhatsApp");
          naoExiste++;
          continue;
        }

        console.log("✅ Existe WhatsApp");
        existeWhats++;

        // 🔒 já banido?
        const isBanido = await dbGet(`SELECT id FROM bans WHERE alvo = ?`, [numero]);

        if (isBanido) {
          console.log("🚫 Já banido");
          jaBanido++;
          continue;
        }

        // ➕ ADD
        try {
          console.log("➕ Tentando adicionar...");
          await sock.groupParticipantsUpdate(groupId, [jid], "add");
          console.log("✅ Adicionado");

          await new Promise((r) => setTimeout(r, 1200));
        } catch (err) {
          console.log("❌ Falha ao adicionar:", err?.message);
          continue;
        }

        // ❌ REMOVE
        try {
          console.log("🗑️ Removendo...");
          await sock.groupParticipantsUpdate(groupId, [jid], "remove");

          await dbRun(
            `INSERT OR IGNORE INTO bans (alvo, admin, grupo_origem, motivo, data) VALUES (?, ?, ?, ?, ?)`,
            [numero, "system-add-limpa", groupId, "add-limpa", Date.now()]
          );

          console.log("🔥 Add + Ban concluído");

          addBan++;
          await new Promise((r) => setTimeout(r, 1200));

        } catch (err) {
          console.log("❌ Falha ao remover:", err?.message);
          continue;
        }

      } catch (err) {
        console.log("💥 Erro geral:", err?.message);
        continue;
      }
    }

    console.log("💾 Bans salvos no SQLite");

    /* ---------------------------------------------------
       RESPOSTA FINAL
    --------------------------------------------------- */
    const resposta =
      `🧹 *RELATÓRIO ADD-LIMPA*\n\n` +
      `📇 VCards analisados: ${totalVcards}\n` +
      `📱 Existem no WhatsApp: ${existeWhats}\n` +
      `🚫 Já eram banidos: ${jaBanido}\n` +
      `⚔️ Add + Ban: ${addBan}\n` +
      `❌ Não possuem WhatsApp: ${naoExiste}`;

    console.log("📤 Enviando resposta final");

    await sock.sendMessage(groupId, { text: resposta });

    console.log("✅ FINALIZADO");

  } catch (err) {
    console.log("💥 ERRO FATAL:", err);
  }
}