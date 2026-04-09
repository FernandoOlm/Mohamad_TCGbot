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
  gerarAnuncioGrupoBlocos,
  gerarRelatorioComprador,
  gerarRelatorioAdmin,
  formatarReais,
  setMsgPagamento,
  getMsgPagamento,
  setMsgInicial,
  getMsgInicial,
  getConfigLeilao,
  delayHumano,
  delayEntreBloco,
} from "../core/leilaoManager.js";

// ============================================================
// !iniciar-leilao — Inicia uma sessão de leilão no grupo
// ============================================================
export async function comandoIniciarLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return { mensagem: "Esse comando só funciona em grupo!" };
  }

  const sender = msg.key.participant || msg.key.remoteJid;
  const result = iniciarSessao(jid, sender);

  if (!result.ok) {
    if (result.motivo === "ja_ativo") {
      return { mensagem: "⚠️ Já tem um leilão rolando nesse grupo! Use *!status-leilao* pra ver como tá, ou *!encerrar-leilao* pra finalizar o atual." };
    }
    return { mensagem: "Deu ruim pra iniciar o leilão..." };
  }

  // Obter nome do grupo ou canal
  let nomeGrupo = "Grupo";
  try {
    if (jid.endsWith("@newsletter")) {
      nomeGrupo = "Canal";
    } else {
      const meta = await sock.groupMetadata(jid);
      nomeGrupo = meta.subject;
    }
  } catch {}

  const msgInicial = getMsgInicial(jid);
  
  let textoCompleto = `🔨 *LEILÃO INICIADO!* 🔨\n\n`;
  textoCompleto += `📍 *${nomeGrupo}*\n`;
  textoCompleto += `🔢 *Leilão #${Date.now().toString().slice(-4)}*\n\n`; // Número único baseado no tempo
  
  if (msgInicial) {
    textoCompleto += `${msgInicial}`;
  } else {
    textoCompleto += `A partir de agora, todas as enquetes criadas serão monitoradas e registrados os votos pelo bot.\n\n`;
    textoCompleto += `📝 *Como criar itens:*\n`;
    textoCompleto += `!enquete Descrição do item | R$ 10 | R$ 20 | R$ 30\n\n`;
    textoCompleto += `🗳️ Os membros votam na opção desejada.\n`;
    textoCompleto += `🔚 Quando terminar, use !encerrar-leilao para fechar e gerar os relatórios.\n\n`;
    textoCompleto += `Bora leiloar! 🚀`;
  }

  return { mensagem: textoCompleto };
}

// ============================================================
// !enquete — Cria uma enquete de venda dentro da sessão ativa
// ============================================================
export async function comandoEnquete(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
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
// Envio HUMANIZADO: blocos de 5 itens + delay 30-50s entre blocos
// ============================================================
export async function comandoEncerrarLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return "Esse comando só funciona em grupo!";
  }

  if (!temSessaoAtiva(jid)) {
    return "⚠️ Não tem nenhum leilão ativo nesse grupo pra encerrar!";
  }

  // Obter nome do grupo/canal
  let grupoNome = jid.endsWith("@newsletter") ? "Canal" : "Grupo";
  if (!jid.endsWith("@newsletter")) {
    try {
      const metadata = await sock.groupMetadata(jid);
      grupoNome = metadata.subject || "Grupo";
    } catch (e) {
      console.error("⚠️ [LEILÃO] Erro ao buscar nome do grupo:", e.message);
    }
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

  // Obter mensagem de pagamento configurada
  const msgPagamento = getMsgPagamento(jid);

  try {
    // ============================================================
    // 1. ENVIAR ANÚNCIO NO GRUPO — EM BLOCOS HUMANIZADOS
    // ============================================================
    const blocos = gerarAnuncioGrupoBlocos(dados);

    for (let i = 0; i < blocos.length; i++) {
      const bloco = blocos[i];
      
      await sock.sendMessage(jid, {
        text: bloco.texto,
        mentions: bloco.mentions,
      });

      // Delay humanizado entre mensagens do grupo (2-5 segundos)
      if (i < blocos.length - 1) {
        await delayHumano(2000, 5000);
      }
    }

    console.log(`📢 [LEILÃO] Anúncio enviado no grupo em ${blocos.length} blocos`);

    // ============================================================
    // 2. ENVIAR RELATÓRIOS INDIVIDUAIS PARA COMPRADORES (PV)
    //    Em blocos de 5 com delay de 30-50s entre blocos
    // ============================================================
    const compradores = Object.entries(dados.comprasPorPessoa);
    const BLOCO_COMPRADORES = 5;

    for (let i = 0; i < compradores.length; i++) {
      const [voterJid, compras] = compradores[i];

      try {
        const textoComprador = gerarRelatorioComprador(voterJid, compras, grupoNome, msgPagamento);
        await sock.sendMessage(voterJid, { text: textoComprador });
        console.log(`📩 [LEILÃO] Relatório enviado para comprador: ${voterJid}`);
      } catch (e) {
        console.error(`⚠️ [LEILÃO] Erro ao enviar relatório para ${voterJid}:`, e.message);
      }

      // Delay humanizado entre cada envio (3-8 segundos)
      await delayHumano(3000, 8000);

      // A cada bloco de 5 compradores, pausa longa de 30-50 segundos
      if ((i + 1) % BLOCO_COMPRADORES === 0 && i < compradores.length - 1) {
        console.log(`⏳ [LEILÃO] Bloco de ${BLOCO_COMPRADORES} relatórios enviados. Pausa longa...`);
        await delayEntreBloco();
      }
    }

    // ============================================================
    // 3. ENVIAR RELATÓRIO CONSOLIDADO PARA O ADMIN (PV)
    // ============================================================
    // Delay antes do relatório admin
    await delayHumano(3000, 6000);

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
// !enquete-s — Cria uma enquete simplificada (Sim/Não)
// ============================================================
export async function comandoEnqueteS(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return { mensagem: "Esse comando só funciona em grupo!" };
  }

  if (!temSessaoAtiva(jid)) {
    return { mensagem: "⚠️ Não tem nenhum leilão ativo nesse grupo! Use *!iniciar-leilao* primeiro." };
  }

  const descricao = args.join(" ").trim();
  if (!descricao) {
    return { mensagem: "⚠️ Use: `!enquete-s Descrição do brinde/pergunta`" };
  }

  const opcoes = ["Sim", "Não"];

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
      return { mensagem: "❌ Erro ao enviar a enquete no grupo. Tenta de novo!" };
    }

    // Armazena a mensagem no messageStore para decryption de votos
    storeMessage(sent);

    // Registra a enquete na sessão ativa
    const result = registrarEnquete(jid, sent.key.id, descricao, opcoes);

    if (!result.ok) {
      return { mensagem: "❌ Erro ao registrar a enquete no sistema. Tenta de novo!" };
    }

    console.log(`📝 [LEILÃO] Enquete-S criada: "${descricao}" (ID: ${sent.key.id})`);

    // Retorna null pois a própria poll já é a resposta visual
    return null;
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao criar enquete-s:", e.message);
    return { mensagem: "❌ Erro ao criar enquete." };
  }
}

// ============================================================
// !enquete-c — Cria uma enquete Sim/Não com valor fixo
// ============================================================
export async function comandoEnqueteC(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return { mensagem: "Esse comando só funciona em grupo!" };
  }

  if (!temSessaoAtiva(jid)) {
    return { mensagem: "⚠️ Não tem nenhum leilão ativo nesse grupo! Use *!iniciar-leilao* primeiro." };
  }

  const full = args.join(" ");
  const partes = full.split("|").map((p) => p.trim()).filter((p) => p.length > 0);

  if (partes.length < 2) {
    return { mensagem: "⚠️ Formato incorreto! Use: `!enquete-c Descrição | Valor`" };
  }

  const descricao = partes[0];
  const valor = partes[1];
  const opcoes = ["Sim", "Não"];

  try {
    // Envia a enquete (poll) no grupo
    const sent = await sock.sendMessage(jid, {
      poll: {
        name: `${descricao} - ${valor}`,
        values: opcoes,
        selectableCount: 1,
      },
    });

    if (!sent?.key?.id) {
      return { mensagem: "❌ Erro ao enviar a enquete no grupo. Tenta de novo!" };
    }

    // Armazena a mensagem no messageStore para decryption de votos
    storeMessage(sent);

    // Registra a enquete na sessão ativa com o valor fixo
    const result = registrarEnquete(jid, sent.key.id, descricao, opcoes, valor);

    if (!result.ok) {
      return { mensagem: "❌ Erro ao registrar a enquete no sistema. Tenta de novo!" };
    }

    console.log(`📝 [LEILÃO] Enquete-C criada: "${descricao}" com valor ${valor} (ID: ${sent.key.id})`);

    // Retorna null pois a própria poll já é a resposta visual
    return null;
  } catch (e) {
    console.error("❌ [LEILÃO] Erro ao criar enquete-c:", e.message);
    return { mensagem: "❌ Erro ao criar enquete." };
  }
}

// ============================================================
// !config-inicial-leilao — Configura a mensagem de abertura
// ============================================================
export async function comandoConfigInicialLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return { mensagem: "Esse comando só funciona em grupo!" };
  }

  const mensagem = args.join(" ").trim();

  if (!mensagem) {
    return { mensagem: "❌ Você precisa informar a mensagem! Ex: `!config-inicial-leilao Leilão de testes`" };
  }

  setMsgInicial(jid, mensagem);
  
  // Reagir com emoji para confirmar o cadastro
  await sock.sendMessage(jid, {
    react: {
      text: "👍",
      key: msg.key
    }
  });

  return null; // Não envia texto, apenas a reação
}

// ============================================================
// !status-leilao — Mostra o status da sessão ativa
// ============================================================
export async function comandoStatusLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
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

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return "Esse comando só funciona em grupo!";
  }

  const result = cancelarSessao(jid);

  if (!result.ok) {
    return "⚠️ Não tem nenhum leilão ativo nesse grupo pra cancelar!";
  }

  return "🚫 *LEILÃO CANCELADO!*\n\nA sessão foi cancelada sem gerar relatórios. Todos os dados foram descartados.";
}

// ============================================================
// !config-msg-leilao — Configura a mensagem de pagamento
// ============================================================
export async function comandoConfigMsgLeilao(msg, sock, from, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us") && !jid.endsWith("@newsletter")) {
    return "Esse comando só funciona em grupo!";
  }

  const mensagem = args.join(" ").trim();

  if (!mensagem) {
    // Mostrar a mensagem atual
    const msgAtual = getMsgPagamento(jid);
    return `📝 *Mensagem de pagamento atual:*\n\n"${msgAtual}"\n\n*Para alterar, use:*\n\`!config-msg-leilao Sua nova mensagem aqui\`\n\nExemplo:\n\`!config-msg-leilao Pix: 11999999999 (Fernando) - Envie o comprovante no PV!\``;
  }

  setMsgPagamento(jid, mensagem);

  return `✅ *Mensagem de pagamento configurada!*\n\nNova mensagem:\n"${mensagem}"\n\nEssa mensagem será enviada no relatório de cada comprador quando o leilão for encerrado.`;
}

// FIM leilao.js
