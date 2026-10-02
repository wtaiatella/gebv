import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;

async function main() {
  console.log('🚀 Iniciando reestruturação dos caminhos, siglas e identificações do PA...');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada no ambiente.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Ler o mapa curricular canônico de Escoteiros
    const paCatalogoRaw = await readFile(path.join(process.cwd(), 'data', 'catalogo', 'pa_catalogo.json'), 'utf8');
    const paCatalogo = JSON.parse(paCatalogoRaw);
    const escoteiroMap = paCatalogo.atividades_map || {};

    // Mapa cd_caminho_paxtu + '_' + cd_atividade_paxtu -> { identificacao, nr_ordenacao }
    const escoteiroIdentMap = new Map();
    for (const [k, v] of Object.entries(escoteiroMap)) {
      const chave = `${v.cd_caminho_paxtu}_${v.cd_atividade_paxtu}`;
      let prefixo = '';
      if (v.cd_caminho_paxtu === '4' || (v.cd_ueb && v.cd_ueb.startsWith('P'))) prefixo = 'P-';
      else if (v.cd_caminho_paxtu === '5') prefixo = 'PT-';
      else if (v.cd_caminho_paxtu === '6') prefixo = 'RT-';
      const idOriginal = `${prefixo}${v.nr_ordenacao}`;
      escoteiroIdentMap.set(chave, {
        identificacao: idOriginal,
        nr_ordenacao: v.nr_ordenacao,
      });
    }

    // 2. Configuração oficial dos Caminhos conforme data/caminhos
    const caminhosConfig = [
      // LOBINHO
      { ramo: 'LOBINHO', codigo: '1', nome: 'Periodo Introdutório', sigla: 'PIL' },
      { ramo: 'LOBINHO', codigo: '2', nome: 'Pata-Tenra e Saltador', sigla: 'PTS' },
      { ramo: 'LOBINHO', codigo: '3', nome: 'Rastreador e Caçador', sigla: 'RC' },

      // ESCOTEIRO
      { ramo: 'ESCOTEIRO', codigo: '4', nome: 'Período introdutório', sigla: 'P' },
      { ramo: 'ESCOTEIRO', codigo: '5', nome: 'Pista e trilha', sigla: 'PT' },
      { ramo: 'ESCOTEIRO', codigo: '6', nome: 'Rumo e travessia', sigla: 'RT' },
      { ramo: 'ESCOTEIRO', codigo: '10', nome: 'Insígnia Modalidade do Ar - Aviador', sigla: 'IAV' },
      { ramo: 'ESCOTEIRO', codigo: '7', nome: 'Insígnia Modalidade do Mar - Grumete', sigla: 'IGR' },

      // SENIOR
      { ramo: 'SENIOR', codigo: '11', nome: 'Período introdutório', sigla: 'PIS' },
      { ramo: 'SENIOR', codigo: '12', nome: 'Escalada, Conquista e Azimute', sigla: 'ECA' },
      { ramo: 'SENIOR', codigo: '8', nome: 'Insígnia Modalidade do Ar - Aeronauta', sigla: 'IAE' },
      { ramo: 'SENIOR', codigo: '9', nome: 'Insígnia Modalidade do Mar - Naval', sigla: 'INV' },

      // PIONEIRO
      { ramo: 'PIONEIRO', codigo: '15', nome: 'Período introdutório', sigla: 'PIP' },
      { ramo: 'PIONEIRO', codigo: '16', nome: 'Comprometimento e Cidadania', sigla: 'CC' },
    ];

    console.log('1. Atualizando tabela pa_caminhos e pa_competencias...');

    for (const c of caminhosConfig) {
      // Atualiza o caminho existente pelo cd_caminho_paxtu
      await client.query(
        `UPDATE pa_caminhos
         SET ds_ramo = $1::"Ramo", nm_caminho = $2
         WHERE cd_caminho_paxtu = $3`,
        [c.ramo, c.nome, c.codigo]
      );

      // Atualiza a competência vinculada a este caminho
      await client.query(
        `UPDATE pa_competencias comp
         SET ds_ramo = $1::"Ramo",
             ds_competencia = CASE 
               WHEN comp.cd_competencia_paxtu LIKE 'caminho_%' THEN $2
               ELSE comp.ds_competencia
             END
         FROM pa_caminhos cam
         WHERE comp.caminho_id = cam.id AND cam.cd_caminho_paxtu = $3`,
        [c.ramo, c.nome, c.codigo]
      );
    }

    console.log('2. Atualizando pa_atividades com ramo correto, ordenação e siglas...');

    for (const c of caminhosConfig) {
      // Busca todas as atividades deste caminho
      const ativsRes = await client.query(
        `SELECT id, cd_atividade_paxtu, ds_atividade
         FROM pa_atividades
         WHERE cd_caminho_paxtu = $1
         ORDER BY 
           CASE 
             WHEN cd_atividade_paxtu = '3187' THEN 9999
             ELSE CAST(REGEXP_REPLACE(cd_atividade_paxtu, '[^0-9]', '', 'g') AS INT)
           END ASC, id ASC`,
        [c.codigo]
      );

      const rows = ativsRes.rows;
      console.log(`   → Caminho ${c.codigo} (${c.ramo} - ${c.sigla}): ${rows.length} atividades`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let ident = '';
        let ord = i + 1;

        // Se for Escoteiro em caminhos 4, 5, 6, usa o mapeamento canônico das fórmulas
        if (c.ramo === 'ESCOTEIRO' && ['4', '5', '6'].includes(c.codigo)) {
          const chave = `${c.codigo}_${row.cd_atividade_paxtu}`;
          const mapped = escoteiroIdentMap.get(chave);
          if (mapped) {
            ident = mapped.identificacao;
            ord = mapped.nr_ordenacao;
          } else {
            ident = `${c.sigla}-${ord}`;
          }
        } else {
          ident = `${c.sigla}-${ord}`;
        }

        await client.query(
          `UPDATE pa_atividades
           SET ds_ramo = $1::"Ramo",
               identificacao = $2,
               nr_ordenacao = $3
           WHERE id = $4`,
          [c.ramo, ident, ord, row.id]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅ Banco de dados atualizado com sucesso no PostgreSQL!');

    // 3. Atualizar o arquivo data/catalogo/pa_catalogo_multiramo.json
    console.log('3. Atualizando data/catalogo/pa_catalogo_multiramo.json...');
    const multiPath = path.join(process.cwd(), 'data', 'catalogo', 'pa_catalogo_multiramo.json');
    const multiRaw = await readFile(multiPath, 'utf8');
    const multiJson = JSON.parse(multiRaw);

    // Reorganiza os ramos no JSON: move caminhos 7 e 10 para ESCOTEIRO
    const caminhos7e10 = (multiJson.SENIOR?.caminhos || []).filter((c) => ['7', '10'].includes(c.cd_caminho_paxtu));
    const comp7e10 = (multiJson.SENIOR?.competencias || []).filter((c) => ['7', '10'].includes(c.cd_caminho_paxtu));
    const ativ7e10 = (multiJson.SENIOR?.atividades || []).filter((a) => ['7', '10'].includes(a.cd_caminho_paxtu));

    // Remove 7 e 10 de SENIOR
    if (multiJson.SENIOR) {
      multiJson.SENIOR.caminhos = multiJson.SENIOR.caminhos.filter((c) => !['7', '10'].includes(c.cd_caminho_paxtu));
      multiJson.SENIOR.competencias = multiJson.SENIOR.competencias.filter((c) => !['7', '10'].includes(c.cd_caminho_paxtu));
      multiJson.SENIOR.atividades = multiJson.SENIOR.atividades.filter((a) => !['7', '10'].includes(a.cd_caminho_paxtu));
    }

    // Adiciona 7 e 10 a ESCOTEIRO
    if (multiJson.ESCOTEIRO) {
      for (const c of caminhos7e10) {
        if (!multiJson.ESCOTEIRO.caminhos.some((x) => x.cd_caminho_paxtu === c.cd_caminho_paxtu)) {
          multiJson.ESCOTEIRO.caminhos.push(c);
        }
      }
      for (const comp of comp7e10) {
        if (!multiJson.ESCOTEIRO.competencias.some((x) => x.cd_competencia_paxtu === comp.cd_competencia_paxtu)) {
          multiJson.ESCOTEIRO.competencias.push(comp);
        }
      }
      for (const ativ of ativ7e10) {
        if (!multiJson.ESCOTEIRO.atividades.some((x) => x.cd_atividade_paxtu === ativ.cd_atividade_paxtu)) {
          multiJson.ESCOTEIRO.atividades.push(ativ);
        }
      }
    }

    // Atualiza nomes e identificações no JSON multiramo
    for (const c of caminhosConfig) {
      const ramoData = multiJson[c.ramo];
      if (!ramoData) continue;

      const cam = (ramoData.caminhos || []).find((x) => x.cd_caminho_paxtu === c.codigo);
      if (cam) {
        cam.nm_caminho = c.nome;
        cam.sigla = c.sigla;
      }

      const ativs = (ramoData.atividades || [])
        .filter((a) => a.cd_caminho_paxtu === c.codigo)
        .sort((a, b) => {
          if (a.cd_atividade_paxtu === '3187') return 1;
          if (b.cd_atividade_paxtu === '3187') return -1;
          return Number(a.cd_atividade_paxtu) - Number(b.cd_atividade_paxtu);
        });

      for (let i = 0; i < ativs.length; i++) {
        const ativ = ativs[i];
        let ident = '';
        let ord = i + 1;

        if (c.ramo === 'ESCOTEIRO' && ['4', '5', '6'].includes(c.codigo)) {
          const chave = `${c.codigo}_${ativ.cd_atividade_paxtu}`;
          const mapped = escoteiroIdentMap.get(chave);
          if (mapped) {
            ident = mapped.identificacao;
            ord = mapped.nr_ordenacao;
          } else {
            ident = `${c.sigla}-${ord}`;
          }
        } else {
          ident = `${c.sigla}-${ord}`;
        }

        ativ.identificacao = ident;
        ativ.nr_ordenacao = ord;
      }
    }

    await writeFile(multiPath, JSON.stringify(multiJson, null, 2), 'utf8');
    console.log('✅ data/catalogo/pa_catalogo_multiramo.json atualizado com sucesso!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na migração:', err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
