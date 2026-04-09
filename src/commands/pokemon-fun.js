// --------------------------------------------------------
// MÓDULO POKÉMON FUN — !quiz e !quem-eu
// Usa APIs reais: PokéAPI + Pokémon TCG API
// Apenas admins e root podem iniciar
// --------------------------------------------------------

import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ========================================
// ESTADO GLOBAL POR GRUPO
// ========================================
const estadoGrupos = {};

function getEstado(grupoId) {
  if (!estadoGrupos[grupoId]) {
    estadoGrupos[grupoId] = {
      quiz_ativo: false,
      resposta_quiz: "",
      quem_eu_ativo: false,
      resposta_quem_eu: [],    // array de nomes aceitos
      nome_exibicao: "",       // nome bonito para mostrar
      dicas_enviadas: 0,
      dicas_total: [],
      cooldown: 0,
      timeout_id: null,
      dica_timeouts: [],       // timeouts das dicas progressivas
      listener: null
    };
  }
  return estadoGrupos[grupoId];
}

// ========================================
// RANKING — Persistência em JSON
// ========================================
const RANKING_PATH = path.resolve("src/data/pokemon-ranking.json");

function loadRanking() {
  try {
    if (!fs.existsSync(RANKING_PATH)) return {};
    return JSON.parse(fs.readFileSync(RANKING_PATH, "utf8"));
  } catch { return {}; }
}

function saveRanking(data) {
  fs.writeFileSync(RANKING_PATH, JSON.stringify(data, null, 2));
}

function addPonto(grupoId, userId, userName) {
  const db = loadRanking();
  if (!db[grupoId]) db[grupoId] = {};
  if (!db[grupoId][userId]) db[grupoId][userId] = { nome: userName, pontos: 0 };
  db[grupoId][userId].nome = userName;
  db[grupoId][userId].pontos += 1;
  saveRanking(db);
  return db[grupoId][userId].pontos;
}

// ========================================
// UTILITÁRIOS
// ========================================

function removerAcentos(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Compara entrada contra QUALQUER nome aceito (array)
function compararRespostaMulti(entrada, nomesAceitos) {
  const a = removerAcentos(entrada.trim().toLowerCase());
  for (const nome of nomesAceitos) {
    const b = removerAcentos(nome.trim().toLowerCase());
    if (a === b) return true;
  }
  return false;
}

// Comparação simples (para quiz)
function compararResposta(entrada, correta) {
  const a = removerAcentos(entrada.trim().toLowerCase());
  const b = removerAcentos(correta.trim().toLowerCase());
  return a === b;
}

// Tradução de tipos Pokémon
const TIPOS_PT = {
  normal: "Normal", fire: "Fogo", water: "Água", electric: "Elétrico",
  grass: "Planta", ice: "Gelo", fighting: "Lutador", poison: "Veneno",
  ground: "Terra", flying: "Voador", psychic: "Psíquico", bug: "Inseto",
  rock: "Pedra", ghost: "Fantasma", dragon: "Dragão", dark: "Sombrio",
  steel: "Aço", fairy: "Fada",
  Fire: "Fogo", Water: "Água", Grass: "Planta", Lightning: "Elétrico",
  Psychic: "Psíquico", Fighting: "Lutador", Darkness: "Sombrio",
  Metal: "Aço", Fairy: "Fada", Dragon: "Dragão", Colorless: "Normal"
};

function traduzirTipo(tipo) {
  return TIPOS_PT[tipo] || tipo;
}

// Tradução de habitats
const HABITATS_PT = {
  "cave": "cavernas", "forest": "florestas", "grassland": "campos e planícies",
  "mountain": "montanhas", "rare": "lugares raros e misteriosos",
  "rough-terrain": "terrenos acidentados", "sea": "mar e oceano",
  "urban": "áreas urbanas", "waters-edge": "beira d'água e rios"
};

// Tradução de cores
const CORES_PT = {
  "black": "preto", "blue": "azul", "brown": "marrom", "gray": "cinza",
  "green": "verde", "pink": "rosa", "purple": "roxo", "red": "vermelho",
  "white": "branco", "yellow": "amarelo"
};

// Tradução de formas/shapes
const FORMAS_PT = {
  "ball": "redondo", "squiggle": "comprido e fino", "fish": "formato de peixe",
  "arms": "tem braços", "blob": "bloboso/gelatinoso", "upright": "bípede/em pé",
  "legs": "tem pernas fortes", "quadruped": "anda de quatro patas",
  "wings": "tem asas", "tentacles": "tem tentáculos", "heads": "tem várias cabeças",
  "humanoid": "forma humanoide", "bug-wings": "inseto com asas", "armor": "tem armadura"
};

// Mapa de nomes PT-BR dos 151 Pokémon da Gen 1
// A PokéAPI não tem pt-br para todos, então mantemos um mapa local
const NOMES_PTBR = {
  "bulbasaur": "Bulbasaur", "ivysaur": "Ivysaur", "venusaur": "Venusaur",
  "charmander": "Charmander", "charmeleon": "Charmeleon", "charizard": "Charizard",
  "squirtle": "Squirtle", "wartortle": "Wartortle", "blastoise": "Blastoise",
  "caterpie": "Caterpie", "metapod": "Metapod", "butterfree": "Butterfree",
  "weedle": "Weedle", "kakuna": "Kakuna", "beedrill": "Beedrill",
  "pidgey": "Pidgey", "pidgeotto": "Pidgeotto", "pidgeot": "Pidgeot",
  "rattata": "Ratata", "raticate": "Raticate",
  "spearow": "Spearow", "fearow": "Fearow",
  "ekans": "Ekans", "arbok": "Arbok",
  "pikachu": "Pikachu", "raichu": "Raichu",
  "sandshrew": "Sandshrew", "sandslash": "Sandslash",
  "nidoran-f": "Nidoran Fêmea", "nidorina": "Nidorina", "nidoqueen": "Nidoqueen",
  "nidoran-m": "Nidoran Macho", "nidorino": "Nidorino", "nidoking": "Nidoking",
  "clefairy": "Clefairy", "clefable": "Clefable",
  "vulpix": "Vulpix", "ninetales": "Ninetales",
  "jigglypuff": "Jigglypuff", "wigglytuff": "Wigglytuff",
  "zubat": "Zubat", "golbat": "Golbat",
  "oddish": "Oddish", "gloom": "Gloom", "vileplume": "Vileplume",
  "paras": "Paras", "parasect": "Parasect",
  "venonat": "Venonat", "venomoth": "Venomoth",
  "diglett": "Diglett", "dugtrio": "Dugtrio",
  "meowth": "Meowth", "persian": "Persian",
  "psyduck": "Psyduck", "golduck": "Golduck",
  "mankey": "Mankey", "primeape": "Primeape",
  "growlithe": "Growlithe", "arcanine": "Arcanine",
  "poliwag": "Poliwag", "poliwhirl": "Poliwhirl", "poliwrath": "Poliwrath",
  "abra": "Abra", "kadabra": "Kadabra", "alakazam": "Alakazam",
  "machop": "Machop", "machoke": "Machoke", "machamp": "Machamp",
  "bellsprout": "Bellsprout", "weepinbell": "Weepinbell", "victreebel": "Victreebel",
  "tentacool": "Tentacool", "tentacruel": "Tentacruel",
  "geodude": "Geodude", "graveler": "Graveler", "golem": "Golem",
  "ponyta": "Ponyta", "rapidash": "Rapidash",
  "slowpoke": "Slowpoke", "slowbro": "Slowbro",
  "magnemite": "Magnemite", "magneton": "Magneton",
  "farfetchd": "Farfetch'd", "farfetch'd": "Farfetch'd",
  "doduo": "Doduo", "dodrio": "Dodrio",
  "seel": "Seel", "dewgong": "Dewgong",
  "grimer": "Grimer", "muk": "Muk",
  "shellder": "Shellder", "cloyster": "Cloyster",
  "gastly": "Gastly", "haunter": "Haunter", "gengar": "Gengar",
  "onix": "Onix", "drowzee": "Drowzee", "hypno": "Hypno",
  "krabby": "Krabby", "kingler": "Kingler",
  "voltorb": "Voltorb", "electrode": "Electrode",
  "exeggcute": "Exeggcute", "exeggutor": "Exeggutor",
  "cubone": "Cubone", "marowak": "Marowak",
  "hitmonlee": "Hitmonlee", "hitmonchan": "Hitmonchan",
  "lickitung": "Lickitung",
  "koffing": "Koffing", "weezing": "Weezing",
  "rhyhorn": "Rhyhorn", "rhydon": "Rhydon",
  "chansey": "Chansey", "tangela": "Tangela",
  "kangaskhan": "Kangaskhan",
  "horsea": "Horsea", "seadra": "Seadra",
  "goldeen": "Goldeen", "seaking": "Seaking",
  "staryu": "Staryu", "starmie": "Starmie",
  "mr-mime": "Mr. Mime", "scyther": "Scyther",
  "jynx": "Jynx", "electabuzz": "Electabuzz", "magmar": "Magmar",
  "pinsir": "Pinsir", "tauros": "Tauros",
  "magikarp": "Magikarp", "gyarados": "Gyarados",
  "lapras": "Lapras", "ditto": "Ditto",
  "eevee": "Eevee", "vaporeon": "Vaporeon", "jolteon": "Jolteon", "flareon": "Flareon",
  "porygon": "Porygon",
  "omanyte": "Omanyte", "omastar": "Omastar",
  "kabuto": "Kabuto", "kabutops": "Kabutops",
  "aerodactyl": "Aerodactyl", "snorlax": "Snorlax",
  "articuno": "Articuno", "zapdos": "Zapdos", "moltres": "Moltres",
  "dratini": "Dratini", "dragonair": "Dragonair", "dragonite": "Dragonite",
  "mewtwo": "Mewtwo", "mew": "Mew"
};

// Nomes alternativos comuns em PT-BR (variações que o pessoal usa)
const NOMES_ALTERNATIVOS = {
  "rattata": ["ratata", "rattata"],
  "raticate": ["raticato", "raticate"],
  "pidgey": ["pidgey", "pidgi"],
  "pidgeotto": ["pidgeotto", "pidgeoto"],
  "pidgeot": ["pidgeot"],
  "spearow": ["spearow", "sparrow"],
  "ekans": ["ekans", "arbok"],
  "nidoran-f": ["nidoran", "nidoran femea", "nidoran f"],
  "nidoran-m": ["nidoran", "nidoran macho", "nidoran m"],
  "clefairy": ["clefairy", "clefary"],
  "jigglypuff": ["jigglypuff", "jiglipuf", "jigglipuff"],
  "wigglytuff": ["wigglytuff", "wiglituf"],
  "oddish": ["oddish"],
  "psyduck": ["psyduck", "paiduck"],
  "growlithe": ["growlithe", "groulite"],
  "arcanine": ["arcanine", "arcanain"],
  "machop": ["machop", "machope"],
  "geodude": ["geodude", "geodud"],
  "ponyta": ["ponyta", "ponita"],
  "rapidash": ["rapidash"],
  "slowpoke": ["slowpoke", "slopoke"],
  "magnemite": ["magnemite", "magnetmite"],
  "farfetchd": ["farfetchd", "farfetch"],
  "farfetch'd": ["farfetchd", "farfetch"],
  "gastly": ["gastly", "gástly", "gastli"],
  "haunter": ["haunter", "hanter"],
  "gengar": ["gengar"],
  "onix": ["onix", "onyx"],
  "mr-mime": ["mr mime", "mr. mime", "mrmime", "senhor mime"],
  "magikarp": ["magikarp", "magicarp"],
  "gyarados": ["gyarados", "garados", "gyrados"],
  "snorlax": ["snorlax"],
  "dratini": ["dratini", "dratine"],
  "dragonite": ["dragonite", "dragonait"],
  "mewtwo": ["mewtwo", "mew two"],
  "mew": ["mew"]
};

// ========================================
// API: POKÉMON TCG (para !quiz)
// ========================================
async function buscarCartaAleatoria() {
  try {
    const pagina = Math.floor(Math.random() * 2000) + 1;
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?pageSize=1&page=${pagina}`);
    if (!res.ok) throw new Error("Erro na API TCG");
    const data = await res.json();
    if (!data.data || data.data.length === 0) throw new Error("Carta não encontrada");
    return data.data[0];
  } catch (e) {
    const fallbacks = ["pikachu", "charizard", "mewtwo", "gengar", "eevee", "snorlax", "dragonite"];
    const nome = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=name:${nome}&pageSize=5`);
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      return data.data[Math.floor(Math.random() * data.data.length)];
    }
    return null;
  }
}

// ========================================
// API: POKÉAPI (para !quem-eu) — COMPLETA
// ========================================
async function buscarPokemonCompleto() {
  try {
    const id = Math.floor(Math.random() * 151) + 1;

    // Buscar dados básicos do Pokémon
    const resPoke = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    if (!resPoke.ok) throw new Error("Erro PokéAPI pokemon");
    const pokemon = await resPoke.json();

    // Buscar dados da espécie (evolução, habitat, cor, categoria)
    const resSpecies = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
    if (!resSpecies.ok) throw new Error("Erro PokéAPI species");
    const species = await resSpecies.json();

    // Buscar cadeia evolutiva
    let chainData = null;
    try {
      const resChain = await fetch(species.evolution_chain.url);
      if (resChain.ok) chainData = await resChain.json();
    } catch { /* cadeia opcional */ }

    return { pokemon, species, chainData };
  } catch {
    return null;
  }
}

// Extrair info da cadeia evolutiva
function extrairEvolucao(chainData, nomeAlvo) {
  if (!chainData) return { estagio: 1, total: 1, evoluiDe: null, evoluiPara: null };

  const cadeia = [];
  function percorrer(chain) {
    cadeia.push(chain.species.name);
    for (const evo of chain.evolves_to || []) {
      percorrer(evo);
    }
  }
  percorrer(chainData.chain);

  const idx = cadeia.indexOf(nomeAlvo);
  const estagio = idx >= 0 ? idx + 1 : 1;
  const total = cadeia.length;
  const evoluiDe = idx > 0 ? cadeia[idx - 1] : null;
  const evoluiPara = idx < cadeia.length - 1 ? cadeia[idx + 1] : null;

  return { estagio, total, evoluiDe, evoluiPara, cadeia };
}

// Montar todos os nomes aceitos para resposta
function montarNomesAceitos(pokemon, species) {
  const nomes = new Set();
  const nomeEN = pokemon.name.toLowerCase();

  // Nome da API (inglês)
  nomes.add(nomeEN);

  // Nome do mapa PT-BR local
  if (NOMES_PTBR[nomeEN]) {
    nomes.add(NOMES_PTBR[nomeEN].toLowerCase());
  }

  // Nomes alternativos
  if (NOMES_ALTERNATIVOS[nomeEN]) {
    for (const alt of NOMES_ALTERNATIVOS[nomeEN]) {
      nomes.add(alt.toLowerCase());
    }
  }

  // Nomes da API (todos os idiomas)
  if (species.names) {
    for (const n of species.names) {
      nomes.add(n.name.toLowerCase());
    }
  }

  return [...nomes];
}

// ========================================
// GERADOR DE DICAS QUEM-EU (HUMANIZADO)
// ========================================
function gerarDicasQuemEu(pokemon, species, chainData) {
  const dicas = [];
  const nome = pokemon.name;
  const tipos = pokemon.types.map(t => traduzirTipo(t.type.name)).join(" e ");
  const peso = (pokemon.weight / 10).toFixed(1);
  const altura = (pokemon.height / 10).toFixed(1);

  // Dados da espécie
  const cor = CORES_PT[species.color?.name] || species.color?.name || "";
  const habitat = HABITATS_PT[species.habitat?.name] || "";
  const forma = FORMAS_PT[species.shape?.name] || "";
  const isLegendary = species.is_legendary;
  const isMythical = species.is_mythical;

  // Categoria (genus) em inglês
  const genusEN = species.genera?.find(g => g.language.name === "en")?.genus || "";

  // Evolução
  const evo = extrairEvolucao(chainData, nome);

  // ---- DICA 1: Tipo (mais fácil, todo mundo conhece) ----
  dicas.push(`💡 *Dica 1:* Sou do tipo *${tipos}*`);

  // ---- DICA 2: Evolução / Estágio (muito útil!) ----
  let dicaEvo = "";
  if (isLegendary) {
    dicaEvo = "Sou um Pokémon *Lendário*! Não tenho evolução.";
  } else if (isMythical) {
    dicaEvo = "Sou um Pokémon *Mítico*! Muito raro de encontrar.";
  } else if (evo.total === 1) {
    dicaEvo = "Sou um Pokémon que *não evolui* e *não tem pré-evolução*.";
  } else if (evo.estagio === 1 && evo.evoluiPara) {
    const nomePara = NOMES_PTBR[evo.evoluiPara] || evo.evoluiPara;
    dicaEvo = `Sou a *forma básica* (1º estágio). Eu evoluo para *${nomePara}*.`;
  } else if (evo.estagio === 2 && evo.evoluiDe && evo.evoluiPara) {
    const nomeDe = NOMES_PTBR[evo.evoluiDe] || evo.evoluiDe;
    dicaEvo = `Sou o *2º estágio*. Evoluo de *${nomeDe}* e ainda tenho uma evolução.`;
  } else if (evo.estagio === 2 && evo.evoluiDe && !evo.evoluiPara) {
    const nomeDe = NOMES_PTBR[evo.evoluiDe] || evo.evoluiDe;
    dicaEvo = `Sou a *evolução final* de *${nomeDe}*.`;
  } else if (evo.estagio === 3) {
    const nomeDe = NOMES_PTBR[evo.evoluiDe] || evo.evoluiDe;
    dicaEvo = `Sou o *3º estágio* (evolução final). Evoluo de *${nomeDe}*.`;
  } else {
    dicaEvo = `Estou no *estágio ${evo.estagio}* de ${evo.total} na minha linha evolutiva.`;
  }
  dicas.push(`💡 *Dica 2:* ${dicaEvo}`);

  // ---- DICA 3: Características físicas (cor, habitat, forma, peso) ----
  const partes = [];
  if (cor) partes.push(`minha cor principal é *${cor}*`);
  if (habitat) partes.push(`vivo em *${habitat}*`);
  if (forma) partes.push(`sou *${forma}*`);
  if (partes.length === 0) {
    partes.push(`peso *${peso}kg* e meço *${altura}m*`);
  }
  dicas.push(`💡 *Dica 3:* ${partes.join(", ")}`);

  // ---- DICA 4: Categoria + peso/altura ----
  let dicaCat = "";
  if (genusEN) {
    dicaCat = `Sou conhecido como *"${genusEN}"*`;
  }
  if (peso && altura) {
    dicaCat += dicaCat ? `, peso *${peso}kg* e meço *${altura}m*` : `Peso *${peso}kg* e meço *${altura}m*`;
  }
  dicas.push(`💡 *Dica 4:* ${dicaCat || "Sou bem conhecido entre os treinadores!"}`);

  // ---- DICA 5: Número na Pokédex + inicial ----
  const nomePT = NOMES_PTBR[nome] || nome;
  dicas.push(`💡 *Dica 5:* Sou o nº *${pokemon.id}* na Pokédex e meu nome começa com *${nomePT[0].toUpperCase()}*`);

  return dicas;
}

// ========================================
// GERADOR DE PERGUNTAS QUIZ
// ========================================
function gerarPerguntaQuiz(carta) {
  const perguntas = [];

  if (carta.hp) {
    perguntas.push({
      pergunta: `🧠 *Quiz Pokémon TCG!*\n\n🃏 Carta: *${carta.name}*\n\n❓ Qual o HP desta carta?`,
      resposta: carta.hp,
      dica: `É um número entre ${Math.max(10, parseInt(carta.hp) - 30)} e ${parseInt(carta.hp) + 30}`
    });
  }

  if (carta.types && carta.types.length > 0) {
    const tipo = carta.types[0];
    perguntas.push({
      pergunta: `🧠 *Quiz Pokémon TCG!*\n\n🃏 Carta: *${carta.name}* (HP: ${carta.hp || "?"})\n\n❓ Qual o tipo desta carta?\n_(em inglês ou português)_`,
      resposta: tipo,
      respostaAlt: traduzirTipo(tipo),
      dica: `Começa com a letra "${tipo[0]}"`
    });
  }

  if (carta.attacks && carta.attacks.length > 0) {
    const ataque = carta.attacks[Math.floor(Math.random() * carta.attacks.length)];
    if (ataque.damage && ataque.damage !== "") {
      perguntas.push({
        pergunta: `🧠 *Quiz Pokémon TCG!*\n\n🃏 Carta: *${carta.name}*\n⚔️ Ataque: *${ataque.name}*\n\n❓ Quanto de dano esse ataque causa?`,
        resposta: ataque.damage.replace("+", "").replace("×", "").trim(),
        dica: `O dano contém o número ${ataque.damage[0]}`
      });
    }
  }

  if (carta.weaknesses && carta.weaknesses.length > 0) {
    const fraqueza = carta.weaknesses[0];
    perguntas.push({
      pergunta: `🧠 *Quiz Pokémon TCG!*\n\n🃏 Carta: *${carta.name}* (Tipo: ${carta.types ? carta.types[0] : "?"})\n\n❓ Qual a fraqueza desta carta?\n_(em inglês ou português)_`,
      resposta: fraqueza.type,
      respostaAlt: traduzirTipo(fraqueza.type),
      dica: `A fraqueza multiplica o dano por ${fraqueza.value}`
    });
  }

  if (perguntas.length === 0) {
    perguntas.push({
      pergunta: `🧠 *Quiz Pokémon TCG!*\n\n🃏 Esta carta tem HP ${carta.hp || "?"} e é do tipo ${carta.types ? carta.types[0] : "?"}.\n\n❓ Qual o nome deste Pokémon?`,
      resposta: carta.name,
      dica: `Começa com "${carta.name.slice(0, 2)}"`
    });
  }

  return perguntas[Math.floor(Math.random() * perguntas.length)];
}

// ========================================
// LIMPAR ESTADO DE JOGO
// ========================================
function limparJogo(estado, sock) {
  clearTimeout(estado.timeout_id);
  // Limpar timeouts de dicas
  if (estado.dica_timeouts) {
    for (const t of estado.dica_timeouts) clearTimeout(t);
    estado.dica_timeouts = [];
  }
  if (estado.listener) {
    try { sock.ev.off("messages.upsert", estado.listener); } catch {}
    estado.listener = null;
  }
}

// ========================================
// LISTENER DE RESPOSTAS
// ========================================
function registrarListener(sock, grupoId, estado, tipo) {
  if (estado.listener) {
    try { sock.ev.off("messages.upsert", estado.listener); } catch {}
    estado.listener = null;
  }

  const handler = async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    if (msg.key.remoteJid !== grupoId) return;

    const texto = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || "";

    if (!texto || texto.startsWith("!")) return;

    const rawUser = msg.key.participant || msg.key.remoteJid;
    const userId = rawUser.replace(/\D/g, "").slice(-15);
    const userName = msg.pushName || userId;

    if (tipo === "quiz" && estado.quiz_ativo) {
      const correto = compararResposta(texto, estado.resposta_quiz);
      const corretoAlt = estado.resposta_quiz_alt ? compararResposta(texto, estado.resposta_quiz_alt) : false;

      if (correto || corretoAlt) {
        estado.quiz_ativo = false;
        limparJogo(estado, sock);
        const pontos = addPonto(grupoId, userId, userName);
        await sock.sendMessage(grupoId, {
          text: `🎯 *Acertou, ${userName}!*\n\nResposta: *${estado.resposta_quiz}*\n⭐ Você tem *${pontos}* ponto(s) no ranking!`
        });
      }
    }

    if (tipo === "quem-eu" && estado.quem_eu_ativo) {
      const correto = compararRespostaMulti(texto, estado.resposta_quem_eu);

      if (correto) {
        estado.quem_eu_ativo = false;
        limparJogo(estado, sock);
        const pontos = addPonto(grupoId, userId, userName);
        await sock.sendMessage(grupoId, {
          text: `🎯 *Acertou, ${userName}!*\n\nEu era o *${estado.nome_exibicao}*!\n⭐ Você tem *${pontos}* ponto(s) no ranking!`
        });
      }
    }
  };

  estado.listener = handler;
  sock.ev.on("messages.upsert", handler);
}

// ========================================
// COMANDO !quiz
// ========================================
export async function comandoQuiz(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { mensagem: "🎮 Esse comando só funciona em grupos!" };
  }

  const estado = getEstado(jid);

  const agora = Date.now();
  if (agora - estado.cooldown < 30000) {
    const restante = Math.ceil((30000 - (agora - estado.cooldown)) / 1000);
    return { mensagem: `⏳ Aguarde ${restante}s para iniciar outro jogo.` };
  }

  if (estado.quiz_ativo || estado.quem_eu_ativo) {
    return { mensagem: "⚠️ Já tem um jogo rolando neste grupo! Aguarde terminar." };
  }

  await sock.sendMessage(jid, { text: "🔄 Buscando carta Pokémon TCG..." });

  const carta = await buscarCartaAleatoria();
  if (!carta) {
    return { mensagem: "😵 Não consegui buscar uma carta. Tente novamente!" };
  }

  const quiz = gerarPerguntaQuiz(carta);

  estado.quiz_ativo = true;
  estado.resposta_quiz = String(quiz.resposta);
  estado.resposta_quiz_alt = quiz.respostaAlt || null;
  estado.cooldown = agora;

  await sock.sendMessage(jid, { text: quiz.pergunta });

  if (carta.images && carta.images.small) {
    try {
      await sock.sendMessage(jid, {
        image: { url: carta.images.small },
        caption: `🃏 ${carta.name} — ${carta.set?.name || "TCG"}`
      });
    } catch {}
  }

  registrarListener(sock, jid, estado, "quiz");

  estado.timeout_id = setTimeout(async () => {
    if (estado.quiz_ativo) {
      estado.quiz_ativo = false;
      limparJogo(estado, sock);
      try {
        await sock.sendMessage(jid, {
          text: `⏱️ *Tempo esgotado!*\n\nA resposta era: *${estado.resposta_quiz}*\n\n💡 Dica: ${quiz.dica || "Fique atento na próxima!"}`
        });
      } catch {}
    }
  }, 30000);

  return null;
}

// ========================================
// COMANDO !quem-eu (MELHORADO)
// ========================================
export async function comandoQuemEu(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { mensagem: "🎮 Esse comando só funciona em grupos!" };
  }

  const estado = getEstado(jid);

  const agora = Date.now();
  if (agora - estado.cooldown < 30000) {
    const restante = Math.ceil((30000 - (agora - estado.cooldown)) / 1000);
    return { mensagem: `⏳ Aguarde ${restante}s para iniciar outro jogo.` };
  }

  if (estado.quiz_ativo || estado.quem_eu_ativo) {
    return { mensagem: "⚠️ Já tem um jogo rolando neste grupo! Aguarde terminar." };
  }

  await sock.sendMessage(jid, { text: "🔄 Buscando um Pokémon misterioso..." });

  const resultado = await buscarPokemonCompleto();
  if (!resultado) {
    return { mensagem: "😵 Não consegui buscar um Pokémon. Tente novamente!" };
  }

  const { pokemon, species, chainData } = resultado;

  // Gerar dicas humanizadas
  const dicas = gerarDicasQuemEu(pokemon, species, chainData);

  // Montar todos os nomes aceitos
  const nomesAceitos = montarNomesAceitos(pokemon, species);
  const nomePT = NOMES_PTBR[pokemon.name] || pokemon.name.charAt(0).toUpperCase() + pokemon.name.slice(1);

  // Configurar estado
  estado.quem_eu_ativo = true;
  estado.resposta_quem_eu = nomesAceitos;
  estado.nome_exibicao = nomePT;
  estado.dicas_enviadas = 0;
  estado.dicas_total = dicas;
  estado.cooldown = agora;
  estado.dica_timeouts = [];

  // Enviar abertura
  await sock.sendMessage(jid, {
    text: `🎭 *Quem sou eu?*\n\nSou um Pokémon da 1ª geração!\nVou dar *${dicas.length} dicas* a cada 10 segundos.\nVocês têm *60 segundos* para adivinhar!\n\n🔽 Primeira dica chegando...`
  });

  // Registrar listener
  registrarListener(sock, jid, estado, "quem-eu");

  // Enviar dicas progressivas com setTimeout (não bloqueia)
  for (let i = 0; i < dicas.length; i++) {
    const delay = i === 0 ? 3000 : 3000 + (i * 10000);
    const t = setTimeout(async () => {
      if (!estado.quem_eu_ativo) return;
      estado.dicas_enviadas = i + 1;
      try {
        await sock.sendMessage(jid, { text: dicas[i] });
      } catch {}
    }, delay);
    estado.dica_timeouts.push(t);
  }

  // Timeout final: 60 segundos totais
  estado.timeout_id = setTimeout(async () => {
    if (estado.quem_eu_ativo) {
      estado.quem_eu_ativo = false;
      limparJogo(estado, sock);
      try {
        const spriteUrl = pokemon.sprites?.other?.["official-artwork"]?.front_default
          || pokemon.sprites?.front_default;
        const textoFinal = `⏱️ *Tempo esgotado!*\n\nEu era o *${nomePT}*!\nNinguém acertou dessa vez. 😬`;
        if (spriteUrl) {
          await sock.sendMessage(jid, { image: { url: spriteUrl }, caption: textoFinal });
        } else {
          await sock.sendMessage(jid, { text: textoFinal });
        }
      } catch {}
    }
  }, 60000);

  return null;
}

// ========================================
// COMANDO !ranking
// ========================================
export async function comandoRanking(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { mensagem: "🏆 Esse comando só funciona em grupos!" };
  }

  const db = loadRanking();
  const grupoRanking = db[jid];

  if (!grupoRanking || Object.keys(grupoRanking).length === 0) {
    return { mensagem: "🏆 Nenhum ranking ainda! Jogue !quiz ou !quem-eu para começar." };
  }

  const sorted = Object.entries(grupoRanking)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 10);

  const medalhas = ["🥇", "🥈", "🥉"];
  let texto = "🏆 *Ranking Pokémon — Top 10*\n\n";

  sorted.forEach((p, i) => {
    const medalha = medalhas[i] || `${i + 1}º`;
    texto += `${medalha} *${p.nome}* — ${p.pontos} ponto(s)\n`;
  });

  texto += "\n_Jogue !quiz ou !quem-eu para subir no ranking!_";

  return { mensagem: texto };
}

// ========================================
// COMANDO !limpar-ranking
// ========================================
export async function comandoLimparRanking(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { mensagem: "🏆 Esse comando só funciona em grupos!" };
  }

  const db = loadRanking();
  
  if (!db[jid] || Object.keys(db[jid]).length === 0) {
    return { mensagem: "🏆 O ranking deste grupo já está vazio!" };
  }

  // Limpa o ranking do grupo atual
  delete db[jid];
  saveRanking(db);

  return { mensagem: "🧹 *Ranking Pokémon limpo com sucesso!* \n\n_Todos os pontos deste grupo foram zerados._" };
}

// ========================================
// COMANDO !parar-jogo
// ========================================
export async function comandoPararJogo(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { mensagem: "Esse comando só funciona em grupos!" };
  }

  const estado = getEstado(jid);

  if (!estado.quiz_ativo && !estado.quem_eu_ativo) {
    return { mensagem: "🎮 Nenhum jogo ativo neste grupo." };
  }

  let resposta = "";
  if (estado.quiz_ativo) {
    resposta = `🛑 Quiz encerrado!\nA resposta era: *${estado.resposta_quiz}*`;
    estado.quiz_ativo = false;
  }
  if (estado.quem_eu_ativo) {
    resposta = `🛑 Quem sou eu encerrado!\nEra o *${estado.nome_exibicao}*`;
    estado.quem_eu_ativo = false;
  }

  limparJogo(estado, sock);

  return { mensagem: resposta || "🛑 Jogo encerrado." };
}

// --------------------------------------------------------
// FIM do módulo Pokémon Fun
// --------------------------------------------------------
