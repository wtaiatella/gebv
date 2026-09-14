import pg from 'pg';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const { Pool } = pg;

async function runVectorExperiment() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERRO: DATABASE_URL não definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log('1. Verificando/Criando estrutura de tabelas no PostgreSQL...');

    // 1.1 Adiciona coluna embedding em pa_especialidades_itens se não existir
    await client.query(`
      ALTER TABLE pa_especialidades_itens 
      ADD COLUMN IF NOT EXISTS embedding double precision[]
    `);
    console.log('✓ Coluna "embedding" garantida em pa_especialidades_itens.');

    // 1.2 Cria tabelas pn_especialidades e pn_especialidades_itens
    await client.query(`
      CREATE TABLE IF NOT EXISTS pn_especialidades (
        id SERIAL PRIMARY KEY,
        cd_especialidade VARCHAR(50),
        ds_especialidade VARCHAR(255) NOT NULL UNIQUE,
        ds_area VARCHAR(100),
        total_itens INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pn_especialidades_itens (
        id SERIAL PRIMARY KEY,
        especialidade_id INT REFERENCES pn_especialidades(id) ON DELETE CASCADE,
        cd_item VARCHAR(50),
        nr_item INT,
        ds_item TEXT NOT NULL,
        embedding double precision[],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ Tabelas pn_especialidades e pn_especialidades_itens criadas/verificadas.');

    // 2. Inserir especialidade Defesa Civil no Programa Novo (PN)
    const espPnRes = await client.query(`
      INSERT INTO pn_especialidades (ds_especialidade, total_itens)
      VALUES ('Defesa Civil', 6)
      ON CONFLICT (ds_especialidade) DO UPDATE SET total_itens = 6
      RETURNING id;
    `);
    const pnEspId = espPnRes.rows[0].id;

    // Itens do PN fornecidos
    const pnItens = [
      {
        nr: 1,
        texto: "Explicar o que é a Defesa Civil, como ela funciona e o que faz um NUPDEC (Núcleo Comunitário de Proteção e Defesa Civil). Identificar a unidade mais próxima do Corpo de Bombeiros e da Defesa Civil e saber como acioná-los em caso de emergência."
      },
      {
        nr: 2,
        texto: "Apresentar as cinco fases da Proteção e Defesa Civil (prevenção, preparação, resposta, recuperação e reconstrução) com exemplos simples de cada uma."
      },
      {
        nr: 3,
        texto: "Explicar os principais tipos de desastres naturais e acidentes que podem ocorrer na sua comunidade (como enchentes, deslizamentos ou incêndios) e explicar como preveni-los ou reduzir seus danos."
      },
      {
        nr: 4,
        texto: "Criar um plano preventivo de segurança para a sua residência, mostrando o que fazer em caso de emergência e como cada pessoa pode ajudar."
      },
      {
        nr: 5,
        texto: "Organizar um exercício simulado de evacuação, praticando como agir de forma calma e segura em uma situação de risco."
      },
      {
        nr: 6,
        texto: "Visitar uma unidade da Defesa Civil ou do Corpo de Bombeiros, registrando o que aprendeu sobre o funcionamento das operações e os equipamentos utilizados nas emergências."
      }
    ];

    await client.query(`DELETE FROM pn_especialidades_itens WHERE especialidade_id = $1`, [pnEspId]);
    for (const item of pnItens) {
      await client.query(`
        INSERT INTO pn_especialidades_itens (especialidade_id, cd_item, nr_item, ds_item)
        VALUES ($1, $2, $3, $4)
      `, [pnEspId, String(item.nr), item.nr, item.texto]);
    }
    console.log(`✓ 6 itens do Programa Novo (PN) inseridos para Defesa Civil.`);

    // 3. Buscar itens do PA (Programa Antigo) para Defesa Civil
    const paEspRes = await client.query(`
      SELECT id FROM pa_especialidades WHERE ds_especialidade ILIKE '%defesa civil%' LIMIT 1
    `);
    if (paEspRes.rows.length === 0) {
      throw new Error('Especialidade Defesa Civil não encontrada no Programa Antigo (pa_especialidades).');
    }
    const paEspId = paEspRes.rows[0].id;

    const paItensRes = await client.query(`
      SELECT id, cd_item, ds_item 
      FROM pa_especialidades_itens 
      WHERE especialidade_id = $1
      ORDER BY id
    `, [paEspId]);
    console.log(`✓ ${paItensRes.rows.length} itens do Programa Antigo (PA) carregados.`);

    const pnItensRes = await client.query(`
      SELECT id, cd_item, nr_item, ds_item 
      FROM pn_especialidades_itens 
      WHERE especialidade_id = $1
      ORDER BY nr_item
    `, [pnEspId]);

    // 4. Gerar Embeddings offline via Python script
    console.log('\n2. Gerando embeddings offline com sentence-transformers (768 dimensões)...');
    
    const payload = {
      pa_items: paItensRes.rows.map(r => ({ id: r.id, cd: r.cd_item, text: r.ds_item })),
      pn_items: pnItensRes.rows.map(r => ({ id: r.id, cd: r.cd_item, nr: r.nr_item, text: r.ds_item }))
    };

    const tempJsonPath = path.join(process.cwd(), 'scripts', 'temp_embeddings_input.json');
    const tempOutPath = path.join(process.cwd(), 'scripts', 'temp_embeddings_output.json');
    fs.writeFileSync(tempJsonPath, JSON.stringify(payload, null, 2), 'utf-8');

    const pyScriptPath = path.join(process.cwd(), 'scripts', 'generate_embeddings_helper.py');
    const pyScript = `import json
from sentence_transformers import SentenceTransformer

with open('${tempJsonPath}', 'r', encoding='utf-8') as f:
    data = json.load(f)

model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-mpnet-base-v2')

pa_texts = [x['text'] for x in data['pa_items']]
pn_texts = [x['text'] for x in data['pn_items']]

pa_embeddings = model.encode(pa_texts, normalize_embeddings=True).tolist()
pn_embeddings = model.encode(pn_texts, normalize_embeddings=True).tolist()

out = {
    'pa_embeddings': pa_embeddings,
    'pn_embeddings': pn_embeddings
}

with open('${tempOutPath}', 'w', encoding='utf-8') as f:
    json.dump(out, f)
print('Embeddings gerados com sucesso!')
`;
    fs.writeFileSync(pyScriptPath, pyScript, 'utf-8');
    execSync(`python3 "${pyScriptPath}"`, { stdio: 'inherit' });
    if (fs.existsSync(pyScriptPath)) fs.unlinkSync(pyScriptPath);

    const embeddingsOut = JSON.parse(fs.readFileSync(tempOutPath, 'utf-8'));

    // 5. Salvar embeddings no banco de dados
    console.log('3. Atualizando embeddings no PostgreSQL...');
    for (let i = 0; i < paItensRes.rows.length; i++) {
      const item = paItensRes.rows[i];
      const emb = embeddingsOut.pa_embeddings[i];
      await client.query(`
        UPDATE pa_especialidades_itens 
        SET embedding = $1 
        WHERE id = $2
      `, [emb, item.id]);
    }

    for (let i = 0; i < pnItensRes.rows.length; i++) {
      const item = pnItensRes.rows[i];
      const emb = embeddingsOut.pn_embeddings[i];
      await client.query(`
        UPDATE pn_especialidades_itens 
        SET embedding = $1 
        WHERE id = $2
      `, [emb, item.id]);
    }
    console.log('✓ Embeddings de 768 dimensões salvos no banco de dados.');

    // 6. Realizar Comparação Vetorial / Similaridade de Cosseno (DE -> PARA)
    console.log('\n=============================================================================');
    console.log('🎯 RELATÓRIO DE COMPARAÇÃO SEMÂNTICA (DE -> PARA): PA -> PN');
    console.log('=============================================================================');

    function dotProduct(a, b) {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
      return sum;
    }

    // A) Visão PA -> Melhor Match no PN
    console.log('\n--- 1. MAPEAMENTO DE CADA ITEM DO PROGRAMA ANTIGO (PA) -> PROGRAMA NOVO (PN) ---\n');
    for (let i = 0; i < paItensRes.rows.length; i++) {
      const paItem = paItensRes.rows[i];
      const paEmb = embeddingsOut.pa_embeddings[i];

      const matches = [];
      for (let j = 0; j < pnItensRes.rows.length; j++) {
        const pnItem = pnItensRes.rows[j];
        const pnEmb = embeddingsOut.pn_embeddings[j];
        const sim = dotProduct(paEmb, pnEmb); // vetores já normalizados
        matches.push({ pnItem, sim });
      }

      matches.sort((a, b) => b.sim - a.sim);
      const best = matches[0];
      const pct = (best.sim * 100).toFixed(1);
      const tag = best.sim >= 0.80 ? '🟢 FORTE' : best.sim >= 0.65 ? '🟡 MÉDIO' : '🔴 BAIXO';

      console.log(`PA Item ${i+1}: "${paItem.ds_item}"`);
      console.log(`  ➔ ${tag} Match com PN Item ${best.pnItem.nr_item} (${pct}% similaridade)`);
      console.log(`     Texto PN: "${best.pnItem.ds_item}"`);
      console.log('');
    }

    // B) Visão PN -> Cobertura a partir do PA
    console.log('\n--- 2. VISÃO INVERSA: COBERTURA DOS REQUISITOS DO PROGRAMA NOVO (PN) PELO PA ---\n');
    for (let j = 0; j < pnItensRes.rows.length; j++) {
      const pnItem = pnItensRes.rows[j];
      const pnEmb = embeddingsOut.pn_embeddings[j];

      const matches = [];
      for (let i = 0; i < paItensRes.rows.length; i++) {
        const paItem = paItensRes.rows[i];
        const paEmb = embeddingsOut.pa_embeddings[i];
        const sim = dotProduct(paEmb, pnEmb);
        matches.push({ paItem, sim, index: i+1 });
      }

      matches.sort((a, b) => b.sim - a.sim);
      const best = matches[0];
      const second = matches[1];

      console.log(`PN Requisito ${pnItem.nr_item}: "${pnItem.ds_item}"`);
      console.log(`  ➔ Principal Equivalente PA: Item ${best.index} (${(best.sim * 100).toFixed(1)}%) -> "${best.paItem.ds_item}"`);
      if (second && second.sim >= 0.65) {
        console.log(`  ➔ Equivalente Secundário PA: Item ${second.index} (${(second.sim * 100).toFixed(1)}%) -> "${second.paItem.ds_item}"`);
      }
      console.log('');
    }

    // Limpeza de arquivos temporários
    if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
    if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);

  } finally {
    client.release();
    await pool.end();
  }
}

runVectorExperiment().catch(err => {
  console.error('Erro no experimento:', err);
  process.exit(1);
});
