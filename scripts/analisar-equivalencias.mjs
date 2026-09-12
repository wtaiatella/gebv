import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const pnCatalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/catalogo/pn_catalogo.json'), 'utf-8'));
const paCatalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/catalogo/pa_catalogo.json'), 'utf-8'));
const espCatalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/pa_especialidades_catalogo.json'), 'utf-8'));
const equivData = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/catalogo/equivalencias.json'), 'utf-8'));

function normalizeText(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSpecialtiesFromText(text) {
  const lower = text.toLowerCase();
  let nivel = 1;
  if (lower.includes('nível 2') || lower.includes('nivel 2')) nivel = 2;
  else if (lower.includes('nível 3') || lower.includes('nivel 3')) nivel = 3;

  const list = [];
  if (lower.includes('especialidade') && text.includes(':')) {
    const parts = text.split(':', 2)[1];
    const items = parts.split(/,|\be\b/i).map((s) => s.trim().replace(/[.;]$/, '')).filter((s) => s.length > 2);
    list.push(...items);
  }
  return { nivel, list };
}

// Stopwords
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'com', 'por', 'que', 'se', 'e', 'ou', 'como', 'mais', 'ao', 'aos', 'seu', 'sua', 'seus', 'suas',
  'sobre', 'entre', 'quando', 'onde', 'pelo', 'pela', 'pelos', 'pelas', 'qual', 'quais', 'cada', 'outro', 'outra',
  'outros', 'outras', 'mesmo', 'mesma', 'mesmos', 'mesmas', 'muito', 'muita', 'muitos', 'muitas', 'pouco',
  'saber', 'sabe', 'conhecer', 'conhece', 'realizar', 'fazer', 'demonstrar', 'explicar', 'apresentar', 'participar',
  'identificar', 'ter', 'estar', 'ser', 'sua', 'seu', 'patrulha', 'tropa', 'ramo', 'escoteiro', 'escoteira', 'acoes', 'acao',
  'pelo', 'menos', 'durante', 'forma', 'atraves', 'diferentes', 'diversas', 'diferente', 'diversos', 'alem', 'conjunto'
]);

// Sinônimos e termos conceituais escoteiros
const SYNONYMS = {
  'fogo': ['fogueira', 'pederneira', 'cozinha', 'lenha', 'fogao', 'chama'],
  'abrigo': ['bivaque', 'barraca', 'acampamento', 'pernoite', 'tenda'],
  'orientacao': ['bussola', 'azimute', 'carta', 'mapa', 'coordenadas', 'topografica', 'gps', 'sol', 'estrelas'],
  'amarras': ['nos', 'pioneiria', 'amarracao', 'corda', 'cabos', 'balso', 'oito', 'esquadria'],
  'socorros': ['primeiros', 'ferimentos', 'fraturas', 'curativos', 'resgate', 'salvamento', 'emergencia', 'engasgo', 'queimadura'],
  'natureza': ['meio', 'ambiente', 'fauna', 'flora', 'trilha', 'conservacao', 'preservacao', 'ecologia', 'arvore', 'animais'],
  'comunicacao': ['morse', 'semafora', 'cifra', 'codigo', 'radio', 'alfabeto', 'mensagem', 'fonetico', 'criptografia'],
  'clima': ['meteorologia', 'tempo', 'chuva', 'nuvens', 'vento', 'previsao', 'temperatura', 'mudancas', 'climaticas'],
  'lixo': ['residuos', 'reciclagem', 'compostagem', 'descarte', 'sustentabilidade', 'plastico'],
  'cidadania': ['democracia', 'comunidade', 'servico', 'patria', 'leis', 'voto', 'assembleia', 'direitos', 'deveres'],
  'espiritualidade': ['fe', 'religiao', 'oracao', 'meditacao', 'deus', 'crenca', 'culto', 'sagrado', 'reflexao'],
  'promessa': ['lei', 'valores', 'principios', 'lealdade', 'honra', 'carater', 'conduta', 'dever'],
  'alimentacao': ['nutricao', 'cardapio', 'refeicao', 'saudavel', 'culinaria', 'alimentos', 'cozinhar'],
  'emocional': ['sentimentos', 'ansiedade', 'empatia', 'estresse', 'afeto', 'autocontrole', 'emocoes', 'saude', 'mental'],
  'agua': ['hidrico', 'manancial', 'rio', 'mar', 'nautica', 'embarcacao', 'consumo', 'hidratacao']
};

function getTokens(text) {
  const norm = normalizeText(text);
  const rawWords = norm.split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w));
  const expanded = new Set(rawWords);
  
  for (const w of rawWords) {
    for (const [key, synList] of Object.entries(SYNONYMS)) {
      if (w === key || w.startsWith(key.slice(0, 4)) || synList.some(s => w === s || w.startsWith(s.slice(0, 4)))) {
        expanded.add(key);
        synList.forEach(s => expanded.add(s));
      }
    }
  }
  return Array.from(expanded);
}

// 1. Compilar base PA
const paItems = [];
if (paCatalog.intro_items) {
  for (const item of paCatalog.intro_items) {
    paItems.push({
      origem: 'PA',
      tipo: 'Intro',
      cd_ref: item.cd_ueb,
      identificacao: `P-${item.cd_ueb.replace(/\D/g, '')}`,
      caminho: 'Período Introdutório',
      competencia: item.ds_competencia,
      area: item.ds_area,
      descricao: item.ds_atividade,
      tokens: getTokens(item.ds_atividade + ' ' + item.ds_competencia + ' ' + item.ds_area)
    });
  }
}

if (paCatalog.competencias) {
  for (const comp of paCatalog.competencias) {
    for (const atv of comp.atividades || []) {
      const isPistas = atv.cd_caminho_paxtu === '5';
      const nr = parseInt(atv.cd_ueb.replace(/\D/g, ''), 10) || 0;
      const idPrefix = isPistas ? 'PT-' : 'RT-';
      paItems.push({
        origem: 'PA',
        tipo: isPistas ? 'Pistas e Trilha' : 'Rumo e Travessia',
        cd_ref: atv.cd_ueb,
        identificacao: `${idPrefix}${nr}`,
        caminho: isPistas ? 'Pistas e Trilha' : 'Rumo e Travessia',
        competencia: comp.ds_competencia,
        area: comp.ds_area,
        descricao: atv.ds_atividade,
        tokens: getTokens(atv.ds_atividade + ' ' + comp.ds_competencia + ' ' + comp.ds_area)
      });
    }
  }
}

// 2. Compilar base Especialidades
const espItems = [];
for (const esp of espCatalog) {
  for (const item of esp.itens || []) {
    espItems.push({
      origem: 'ESP',
      cd_especialidade: esp.cd_especialidade,
      nm_especialidade: esp.ds_especialidade,
      cd_item: item.cd_item,
      cd_ref: `${esp.ds_especialidade} (Item ${item.cd_item})`,
      descricao: item.ds_item,
      tokens: getTokens(esp.ds_especialidade + ' ' + item.ds_item)
    });
  }
}

function calcSimilarity(tokensA, tokensB, textA, textB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  let matches = 0;
  for (const t of tokensA) {
    if (setB.has(t)) {
      matches += 1.2;
    } else {
      for (const tb of tokensB) {
        if ((t.length >= 4 && tb.startsWith(t.slice(0, 4))) || (tb.length >= 4 && t.startsWith(tb.slice(0, 4)))) {
          matches += 0.6;
          break;
        }
      }
    }
  }
  let score = (2 * matches) / (tokensA.length + tokensB.length);
  
  // Exact substring boost
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);
  if (normA.includes(normB) || normB.includes(normA)) {
    score += 0.3;
  }
  return score;
}

// 3. Extrair 105 ações sem equivalência do PN
const semEquivAcoes = [];
pnCatalog.acoes.forEach((acao, i) => {
  const normBloco = normalizeText(acao.bloco);
  const normAcao = normalizeText(acao.ds_acao);

  const matchedRegras = equivData.regras.filter((r) => {
    if (!r.bloco || !r.ds_acao_c) return false;
    const rNormBloco = normalizeText(r.bloco);
    const rNormAcao = normalizeText(r.ds_acao_c);
    if (rNormBloco !== normBloco) return false;
    return (
      rNormAcao === normAcao ||
      (rNormAcao.length > 20 && normAcao.startsWith(rNormAcao.slice(0, 30))) ||
      (normAcao.length > 20 && rNormAcao.startsWith(normAcao.slice(0, 30))) ||
      normAcao.includes(rNormAcao) ||
      rNormAcao.includes(normAcao)
    );
  });

  const pistasSet = new Set();
  const rumoSet = new Set();
  const espSet = new Set();

  for (const r of matchedRegras) {
    (r.refs_pistas_ueb || []).forEach((p) => pistasSet.add(p));
    (r.refs_rumo_ueb || []).forEach((rm) => rumoSet.add(rm));
    (r.refs_especialidades || []).forEach((e) => espSet.add(e));
  }

  const parsedTextEsp = parseSpecialtiesFromText(acao.ds_acao);
  parsedTextEsp.list.forEach((e) => espSet.add(e));

  if (normAcao.includes('conquistar no ramo escoteiro uma especialidade sobre um tema de seu interesse')) {
    pistasSet.clear();
    rumoSet.clear();
    espSet.clear();
  }

  const total = pistasSet.size + rumoSet.size + espSet.size;
  if (total === 0) {
    semEquivAcoes.push({
      nr_ordem: i + 1,
      eixo: acao.eixo,
      bloco: acao.bloco,
      tp_acao: acao.tp_acao,
      modalidade: acao.modalidade,
      ds_acao: acao.ds_acao
    });
  }
});

console.log(`Processando análise para ${semEquivAcoes.length} ações SEM_EQUIVALENCIA...`);

const propostas = [];

for (const item of semEquivAcoes) {
  const pnTokens = getTokens(item.ds_acao + ' ' + item.bloco + ' ' + item.eixo);

  // Match com PA
  const scoresPA = paItems.map(p => ({
    tipo: 'PA',
    cd_ref: p.cd_ref,
    identificacao: p.identificacao,
    caminho: p.caminho,
    area: p.area,
    competencia: p.competencia,
    descricao: p.descricao,
    score: calcSimilarity(pnTokens, p.tokens, item.ds_acao, p.descricao)
  })).sort((a, b) => b.score - a.score);

  // Match com Especialidades
  const scoresESP = espItems.map(e => ({
    tipo: 'ESPECIALIDADE',
    cd_especialidade: e.cd_especialidade,
    nm_especialidade: e.nm_especialidade,
    cd_item: e.cd_item,
    cd_ref: e.cd_ref,
    descricao: e.descricao,
    score: calcSimilarity(pnTokens, e.tokens, item.ds_acao, e.descricao)
  })).sort((a, b) => b.score - a.score);

  const topPA = scoresPA.slice(0, 3).filter(x => x.score > 0.12);
  const topESP = scoresESP.slice(0, 3).filter(x => x.score > 0.12);

  propostas.push({
    nr_ordem: item.nr_ordem,
    eixo: item.eixo,
    bloco: item.bloco,
    tp_acao: item.tp_acao,
    modalidade: item.modalidade,
    ds_acao: item.ds_acao,
    candidatos_pa: topPA,
    candidatos_esp: topESP
  });
}

const outputPath = path.join(ROOT_DIR, 'data/propostas_novas_equivalencias.json');
fs.writeFileSync(outputPath, JSON.stringify(propostas, null, 2), 'utf-8');
console.log(`✓ Análise completa! Resultados salvos em ${outputPath}`);
