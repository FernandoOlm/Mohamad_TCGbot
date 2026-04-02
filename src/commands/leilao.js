// INÍCIO leilao.js — Comandos do Sistema de Leilão por Enquete
import {
  iniciarSessao,
  temSessaoAtiva,
  registrarEnquete,
  registrarVotoFallback,
  getStatusSessao,
  cancelarSessao,
  encerrarSessao,
  storeMessage,
  gerarAnuncioGrupo,
  gerarRelatorioComprador,
  gerarRelatorioAdmin,
  formatarReais,
} from "../core/leilaoManager.js";

// ============================================================
// !iniciar-leilao — Inicia uma sessão de leilão no grupo
// ============================================================
export async function comandoIniciarLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return "Esse comando só funciona em grupo!";
  }

  const sender = msg.key.participant || msg.key.remoteJid;
  const result = iniciarSessao(jid, sender);

  if (!result.ok) {
    if (result.motivo === "ja_ativo") {
      return "⚠️ Já tem um leilão rolando nesse grupo! Use *!status-leilao* pra ver como tá, ou *!encerrar-leilao* pra finalizar o atual.";
    }
    return "Deu ruim pra iniciar o leilão...";
  }

  return "🔨 *LEILÃO INICIADO!* 🔨\n\n" +
    "A partir de agora, todas as enquetes criadas com *!enquete* serão registradas nesta sessão.\n\n" +
    "📝 *Como criar itens:*\n" +
    "`!enquete Descrição do item | R$ 10 | R$ 20 | R$ 30`\n\n" +
    "🗳️ Os membros votam na opção desejada.\n" +
    "🔚 Quando terminar, use *!encerrar-leilao* para fechar e gerar os relatórios.\n\n" +
    "Bora leiloar! 🚀";
}

// ============================================================
// !enquete — Cria uma enquete de venda dentro da sessão ativa
// ============================================================
export async function comandoEnquete(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return "Esse comando só funciona em grupo!";
  }

  // Verifica se há sessão ativa
  if (!temSessaoAtiva(jid)) {
    return "⚠️ Não tem nenhum leilão ativo nesse grupo! Use *!iniciar-leilao* primeiro.";
  }

  // Parse dos argumentos: Descrição | Opção 1 | Opção 2 | ...
  const full = args.join(" ");
  const partes = full.split("|").map((p) => p.trim()).filter((p) => p.length > 0);

  if (partes.length < 3) {
    return "⚠️ Formato incorreto! Use:\n`!enquete Descrição do item | Opção 1 | Opção 2 | Opção 3`\n\nExemplo:\n`!enquete Pikachu Holo 1st Ed | R$ 50 | R$ 100 | R$ 150 | R$ 200`";
  }

  const descricao = partes[0];
  const opcoes = partes.slice(1);

  if (opcoes.length > 12) {
    return "⚠️ O WhatsApp permite no máximo 12 opções por enquete!";
  }

  try {
    // Envia a enquete (poll) no grupo
    const sent = await sock.sendMessage(jid, {
      poll: {
        name: descricao,
        values: opcoes,
        selectableCount: 1,
      },
    });

    if (!sent?.key?.id) {
      return "❌ Erro ao enviar a enquete no grupo. Tenta de novo!";
    }

    // Armazena a mensagem no messageStore para decryption de votos
    storeMessage(sent);

    // Registra a enquete na sessão ativa
    const result = registrarEnquete(jid, sent.key.id, descricao, opcoes);

    if (!result.ok) {
      return "❌ Erro ao registrar a enquete no sistema. Tenta de novo!";
    }

    console.log(`📝 [LEILÃO] Enquete criada: "${descricao}" com ${opcoes.length} opções (ID: ${sent.key.id})`);

    // Retorna null porque a própria poll já é a resposta visual
    return null;
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao criar enquete:", e.message);
    return "❌ Deu erro pra criar a enquete... Tenta de novo!";
  }
}

// ============================================================
// !encerrar-leilao — Encerra a sessão e gera relatórios
// ============================================================
export async function comandoEncerrarLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return "Esse comando só funciona em grupo!";
  }

  if (!temSessaoAtiva(jid)) {
    return "⚠️ Não tem nenhum leilão ativo nesse grupo pra encerrar!";
  }

  // Obter nome do grupo
  let grupoNome = "Grupo";
  try {
    const metadata = await sock.groupMetadata(jid);
    grupoNome = metadata.subject || "Grupo";
  } catch (e) {
    console.error("⚠️ [LEILÃO] Erro ao buscar nome do grupo:", e.message);
  }

  // Encerrar sessão e calcular resultados
  const dados = encerrarSessao(jid, grupoNome);

  if (!dados.ok) {
    if (dados.motivo === "sem_sessao") {
      return "⚠️ Não tem nenhum leilão ativo nesse grupo!";
    }
    if (dados.motivo === "sem_enquetes") {
      return "🔨 Leilão encerrado, mas nenhuma enquete foi criada. Nada pra relatar!";
    }
    return "❌ Erro ao encerrar o leilão...";
  }

  try {
    // 1. ENVIAR ANÚNCIO NO GRUPO
    const anuncio = gerarAnuncioGrupo(dados);
    await sock.sendMessage(jid, {
      text: anuncio.texto,
      mentions: anuncio.mentions,
    });

    // 2. ENVIAR RELATÓRIO INDIVIDUAL PARA CADA COMPRADOR (PV)
    for (const [voterJid, compras] of Object.entries(dados.comprasPorPessoa)) {
      try {
        const textoComprador = gerarRelatorioComprador(voterJid, compras, grupoNome);
        await sock.sendMessage(voterJid, { text: textoComprador });
        console.log(`📩 [LEILÃO] Relatório enviado para comprador: ${voterJid}`);

        // Pequeno delay para evitar rate limit do WhatsApp
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (e) {
        console.error(`⚠️ [LEILÃO] Erro ao enviar relatório para ${voterJid}:`, e.message);
      }
    }

    // 3. ENVIAR RELATÓRIO CONSOLIDADO PARA O ADMIN (PV)
    try {
      const relatorioAdmin = gerarRelatorioAdmin(dados, grupoNome);
      await sock.sendMessage(sender, {
        text: relatorioAdmin.texto,
        mentions: relatorioAdmin.mentions,
      });
      console.log(`📩 [LEILÃO] Relatório admin enviado para: ${sender}`);
    } catch (e) {
      console.error(`⚠️ [LEILÃO] Erro ao enviar relatório admin:`, e.message);
      // Fallback: enviar no grupo
      try {
        const relatorioAdmin = gerarRelatorioAdmin(dados, grupoNome);
        await sock.sendMessage(jid, {
          text: relatorioAdmin.texto,
          mentions: relatorioAdmin.mentions,
        });
      } catch (e2) {
        console.error("❌ [LEILÃO] Erro ao enviar relatório admin no grupo:", e2.message);
      }
    }

    // Retorna null pois já enviamos as mensagens diretamente
    return null;
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao enviar relatórios:", e.message);
    return "🔨 Leilão encerrado com sucesso, mas houve erro ao enviar alguns relatórios. Verifique o console!";
  }
}

// ============================================================
// !status-leilao — Mostra o status da sessão ativa
// ============================================================
export async function comandoStatusLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return "Esse comando só funciona em grupo!";
  }

  const status = getStatusSessao(jid);

  if (!status) {
    return "📊 Não tem nenhum leilão ativo nesse grupo no momento.";
  }

  const horaInicio = new Date(status.iniciadoEm).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let texto = "📊 *STATUS DO LEILÃO* 📊\n\n";
  texto += `🕒 *Iniciado às:* ${horaInicio}\n`;
  texto += `📦 *Total de itens:* ${status.totalEnquetes}\n`;
  texto += `🗳️ *Total de votos:* ${status.totalVotos}\n\n`;

  if (status.enquetes.length > 0) {
    texto += "━━━━━━━━━━━━━━━━━━━━\n";
    texto += "*ITENS DO LEILÃO:*\n";
    texto += "━━━━━━━━━━━━━━━━━━━━\n\n";

    status.enquetes.forEach((e, i) => {
      const emoji = e.numVotos > 0 ? "🟢" : "⚪";
      texto += `${emoji} ${i + 1}. *${e.descricao}*\n`;
      texto += `   Opções: ${e.opcoes.join(" | ")}\n`;
      texto += `   Votos: ${e.numVotos}\n\n`;
    });
  }

  texto += "Use *!encerrar-leilao* quando quiser finalizar. 🔨";

  return texto;
}

// ============================================================
// !cancelar-leilao — Cancela a sessão sem relatórios (ROOT only)
// ============================================================
export async function comandoCancelarLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return "Esse comando só funciona em grupo!";
  }

  const result = cancelarSessao(jid);

  if (!result.ok) {
    return "⚠️ Não tem nenhum leilão ativo nesse grupo pra cancelar!";
  }

  return "🚫 *LEILÃO CANCELADO!*\n\nA sessão foi cancelada sem gerar relatórios. Todos os dados foram descartados.";
}

// FIM leilao.js
