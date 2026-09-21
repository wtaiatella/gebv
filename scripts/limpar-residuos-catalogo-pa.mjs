import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Limpeza de Resíduos do Catálogo PA (T001) ===');

  const jsonPath = path.resolve(process.cwd(), 'data/especialidades/pa/especialidades_pa.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Arquivo não encontrado: ${jsonPath}`);
  }

  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const canonicalKeys = new Set();
  let totalJsonItems = 0;

  for (const esp of jsonContent) {
    for (const it of esp.itens || []) {
      const itemCd = String(it.cd_item || it.nr_item);
      canonicalKeys.add(`${esp.cd_especialidade}::${itemCd}`);
      totalJsonItems++;
    }
  }

  console.log(`✓ JSON Canônico carregado: ${jsonContent.length} especialidades, ${totalJsonItems} itens.`);

  const dbItens = await prisma.paEspecialidadeItem.findMany({
    include: {
      especialidade: {
        select: {
          cd_especialidade: true,
          ds_especialidade: true,
        },
      },
    },
  });

  console.log(`✓ Total atual de itens no banco: ${dbItens.length}`);

  const extraItens = [];
  for (const it of dbItens) {
    const key = `${it.especialidade.cd_especialidade}::${String(it.cd_item)}`;
    if (!canonicalKeys.has(key)) {
      extraItens.push(it);
    }
  }

  console.log(`🔍 Itens residuais/espúrios identificados: ${extraItens.length}`);

  if (extraItens.length === 0) {
    console.log('✓ Nenhum item residual para remover. O banco já está perfeitamente alinhado!');
    return;
  }

  for (const it of extraItens) {
    console.log(
      `   - [ID ${it.id}] Esp ${it.especialidade.cd_especialidade} (${it.especialidade.ds_especialidade}) Item ${it.cd_item}: "${it.ds_item.slice(0, 45)}..."`
    );
  }

  const extraIds = extraItens.map((it) => it.id);

  // 1. Limpa eventuais vínculos em progressao_especialidade_item_pa (se houver)
  const deletedProgressoes = await prisma.progressaoEspecialidadeItemPa.deleteMany({
    where: { especialidade_item_id: { in: extraIds } },
  });
  console.log(`✓ Removidos ${deletedProgressoes.count} registros vinculados em progressao_especialidade_item_pa.`);

  // 2. Remove os itens do catálogo
  const deletedItens = await prisma.paEspecialidadeItem.deleteMany({
    where: { id: { in: extraIds } },
  });
  console.log(`✓ Removidos ${deletedItens.count} itens residuais de pa_especialidades_itens.`);

  // 3. Validação final
  const finalCount = await prisma.paEspecialidadeItem.count();
  console.log(`✓ Contagem final no banco: ${finalCount} itens.`);

  if (finalCount === totalJsonItems) {
    console.log(`✅ Sucesso! Paridade absoluta alcançada: exatamente ${finalCount} itens no catálogo PA.`);
  } else {
    throw new Error(`Falha na validação: esperado ${totalJsonItems}, encontrado ${finalCount}.`);
  }
}

main()
  .catch((err) => {
    console.error('❌ Erro durante a limpeza:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
