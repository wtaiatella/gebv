import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const propostas = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/propostas_novas_equivalencias.json'), 'utf-8'));

let md = `# Análise e Propostas de Novas Equivalências (105 Ações PN 'Sem Relação')

Este documento reúne a análise semântica e pedagógica das **105 ações educativas do Novo Programa (PN)** que atualmente constam como \`SEM_EQUIVALENCIA\` (sem relação com o Programa Antigo ou Especialidades).

---

## Estrutura de Leitura
- **Ação PN**: Texto e modalidade da ação no Novo Programa.
- **Candidato PA**: Atividade do Programa Antigo (Período Introdutório, Pistas e Trilha, Rumo e Travessia).
- **Candidato Especialidade**: Especialidade e item do catálogo nacional da UEB.
- **Recomendação**:
  - \`DIRETA\`: Uma atividade do PA cobre diretamente.
  - \`OR\`: Pode ser atendida por PA ou Especialidade equivalente.
  - \`ESPECIALIDADE\`: Pode ser validada por uma Especialidade temática.
  - \`EXCLUSIVA_PN\`: Ação genuinamente nova do PN (ex: competências digitais modernas, projetos específicos de patrulha sem paralelo no PA) $\\rightarrow$ deve permanecer com validação manual/ativação no PN.

---
`;

const byEixo = {};
for (const p of propostas) {
  if (!byEixo[p.eixo]) byEixo[p.eixo] = {};
  if (!byEixo[p.eixo][p.bloco]) byEixo[p.eixo][p.bloco] = [];
  byEixo[p.eixo][p.bloco].push(p);
}

for (const [eixo, blocos] of Object.entries(byEixo)) {
  md += `\n# Eixo: ${eixo}\n\n`;

  for (const [bloco, itens] of Object.entries(blocos)) {
    md += `## Bloco: ${bloco} (${itens.length} ações)\n\n`;

    for (const item of itens) {
      const topPA = item.candidatos_pa[0];
      const topESP = item.candidatos_esp[0];
      const altESP = item.candidatos_esp[1];

      let recomendacao = 'EXCLUSIVA_PN';
      let sugestaoRegra = 'Manter SEM_EQUIVALENCIA (Atividade exclusiva do PN)';

      if (topPA && topPA.score >= 0.25) {
        recomendacao = 'DIRETA / OR';
        sugestaoRegra = `Equivalência com PA **${topPA.identificacao}** (${topPA.tipo})`;
      } else if (topESP && topESP.score >= 0.22) {
        recomendacao = 'ESPECIALIDADE';
        sugestaoRegra = `Equivalência com Especialidade **${topESP.nm_especialidade}**`;
      } else if (topPA && topPA.score >= 0.15) {
        recomendacao = 'PARCIAL_PA';
        sugestaoRegra = `Possível equivalência parcial com PA **${topPA.identificacao}**`;
      } else if (topESP && topESP.score >= 0.15) {
        recomendacao = 'PARCIAL_ESP';
        sugestaoRegra = `Possível equivalência com Especialidade **${topESP.nm_especialidade}**`;
      }

      md += `### [Item #${item.nr_ordem}] ${item.tp_acao} (${item.modalidade})\n`;
      md += `> **Ação PN**: ${item.ds_acao}\n\n`;
      
      md += `| Origem | Correspondência Candidata | Aderência / Detalhes |\n`;
      md += `| :--- | :--- | :--- |\n`;

      if (topPA) {
        md += `| **PA** | **${topPA.identificacao}** (${topPA.caminho} - ${topPA.competencia}) | ${topPA.descricao} (Score: ${(topPA.score * 100).toFixed(0)}%) |\n`;
      } else {
        md += `| **PA** | *(Nenhuma atividade PA com aderência suficiente)* | - |\n`;
      }

      if (topESP) {
        md += `| **Especialidade** | **${topESP.cd_ref}** | ${topESP.descricao} (Score: ${(topESP.score * 100).toFixed(0)}%) |\n`;
      }
      if (altESP && altESP.score > 0.15) {
        md += `| **Especialidade (Alt)** | **${altESP.cd_ref}** | ${altESP.descricao} (Score: ${(altESP.score * 100).toFixed(0)}%) |\n`;
      }

      md += `\n**💡 Sugestão Preliminar**: \`${recomendacao}\` — ${sugestaoRegra}\n\n`;
      md += `**Decisão**: [ ] Aceitar sugestão &nbsp;&nbsp; [ ] Manter sem relação &nbsp;&nbsp; [ ] Definir outra regra:\n\n`;
      md += `---\n\n`;
    }
  }
}

const outputPath = path.join(ROOT_DIR, 'docs/propostas_novas_equivalencias.md');
fs.writeFileSync(outputPath, md, 'utf-8');
console.log(`Documento Markdown gerado em: ${outputPath}`);
