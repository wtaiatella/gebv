import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
const cookie = process.env.PAXTU_COOKIE;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetch(url) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      cookie,
      'x-requested-with': 'XMLHttpRequest',
      referer: `${BASE_URL}/associado/lista`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);
  return res.json();
}

async function main() {
  console.log('Construindo catálogo PA completo e integrado para todos os ramos...');

  const ramosConfig = [
    {
      ramo: 'LOBINHO',
      folder: 'alcateia',
      sampleCode: '1524615',
      compFile: '03-competences-show-branch-2.json',
      caminhosPrefix: 'L-',
    },
    {
      ramo: 'ESCOTEIRO',
      folder: 'escoteiros',
      sampleCode: '1343627',
      compFile: '03-competences-show-branch-1.json',
      caminhosPrefix: 'E-',
    },
    {
      ramo: 'SENIOR',
      folder: 'senior',
      sampleCode: '1443043',
      compFile: '03-competences-show-branch-3.json',
      caminhosPrefix: 'S-',
    },
    {
      ramo: 'PIONEIRO',
      folder: 'pioneiros',
      sampleCode: '923757',
      compFile: '03-competences-show-branch-4.json',
      caminhosPrefix: 'P-',
    },
  ];

  const catalogoFinal = {};

  for (const r of ramosConfig) {
    console.log(`\n=== Processando Ramo ${r.ramo} ===`);
    const { readdirSync, statSync } = await import('node:fs');
    const baseDir = path.join(process.cwd(), 'data', 'raw', r.folder);
    const youthFolder = readdirSync(baseDir).find((f) => statSync(path.join(baseDir, f)).isDirectory());
    const compRaw = await readFile(path.join(baseDir, youthFolder, r.compFile), 'utf8');
    const compList = JSON.parse(compRaw);

    const caminhosMap = new Map();
    const competênciasFinais = [];
    const atividadesFinais = [];
    const seenAtivIds = new Set();

    // 1. Identifica caminhos
    for (const item of compList) {
      const cId = String(item.caminho_id || item.id);
      if (!caminhosMap.has(cId) && item.caminho) {
        caminhosMap.set(cId, {
          cd_caminho_paxtu: cId.replace('caminho_', ''),
          nm_caminho: item.caminho,
        });
      }
    }

    // Adiciona caminhos adicionais se houver atividades em caminhos sem competência
    const ativDir = path.join(baseDir, youthFolder, 'atividades');
    const ativFiles = readdirSync(ativDir).filter((f) => f.startsWith('activities-'));

    for (const af of ativFiles) {
      const m = af.match(/activities-caminho_(\d+)\.json/);
      if (m && !caminhosMap.has(m[1])) {
        caminhosMap.set(m[1], {
          cd_caminho_paxtu: m[1],
          nm_caminho: `Caminho ${m[1]}`,
        });
      }
    }

    console.log(`  ${caminhosMap.size} caminhos identificados.`);

    // 2. Extrai competências e busca as atividades vinculadas a cada uma
    for (const c of compList) {
      const isDireto = c.tipo === 'caminho_direto';
      const cIdStr = String(c.caminho_id || c.id).replace('caminho_', '');
      const compIdStr = String(c.id);

      competênciasFinais.push({
        cd_competencia_paxtu: compIdStr,
        cd_caminho_paxtu: cIdStr,
        ds_competencia: c.nome,
        tipo: c.tipo,
      });

      // Busca atividades dessa competência ou caminho
      try {
        const queryId = isDireto ? `caminho_${cIdStr}` : c.id;
        const url = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${r.sampleCode}&competence_id=${queryId}`;
        const data = await safeFetch(url);
        const list = Array.isArray(data) ? data : data.activities || [];

        for (const atv of list) {
          const atvIdStr = String(atv.codigo || atv.id);
          if (!seenAtivIds.has(atvIdStr)) {
            seenAtivIds.add(atvIdStr);
            atividadesFinais.push({
              cd_atividade_paxtu: atvIdStr,
              cd_caminho_paxtu: cIdStr,
              cd_competencia_paxtu: compIdStr,
              ds_atividade: (atv.descricao || atv.ds_atividade || '').trim(),
            });
          }
        }
        await sleep(150);
      } catch (err) {
        console.warn(`    Aviso ao buscar atividades para ${c.nome}:`, err.message);
      }
    }

    // 3. Fallback: carrega quaisquer atividades restantes dos arquivos de caminho que não vieram por competência
    for (const af of ativFiles) {
      const m = af.match(/activities-caminho_(\d+)\.json/);
      const cIdStr = m ? m[1] : '';
      const ativRaw = await readFile(path.join(ativDir, af), 'utf8');
      const ativData = JSON.parse(ativRaw);
      const list = Array.isArray(ativData) ? ativData : ativData.activities || [];

      for (const atv of list) {
        const atvIdStr = String(atv.codigo || atv.id);
        if (!seenAtivIds.has(atvIdStr)) {
          seenAtivIds.add(atvIdStr);
          atividadesFinais.push({
            cd_atividade_paxtu: atvIdStr,
            cd_caminho_paxtu: cIdStr,
            cd_competencia_paxtu: `caminho_${cIdStr}`,
            ds_atividade: (atv.descricao || atv.ds_atividade || '').trim(),
          });
        }
      }
    }

    console.log(`  ✓ ${competênciasFinais.length} competências e ${atividadesFinais.length} atividades capturadas.`);

    catalogoFinal[r.ramo] = {
      ramo: r.ramo,
      caminhos: Array.from(caminhosMap.values()),
      competencias: competênciasFinais,
      atividades: atividadesFinais,
    };
  }

  const outPath = path.join(process.cwd(), 'data', 'catalogo', 'pa_catalogo_multiramo.json');
  await writeFile(outPath, JSON.stringify(catalogoFinal, null, 2), 'utf8');
  console.log(`\n🎉 Catálogo PA Multi-Ramo salvo com sucesso em: ${outPath}`);

  // Resumo
  for (const [ramo, data] of Object.entries(catalogoFinal)) {
    console.log(`- ${ramo}: ${data.caminhos.length} caminhos, ${data.competencias.length} competências, ${data.atividades.length} atividades`);
  }
}

main().catch(console.error);
