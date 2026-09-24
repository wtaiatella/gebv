#!/usr/bin/env python3
"""
Script autônomo offline para cálculo de embeddings 1024d com BAAI/bge-m3
para os itens de progressão (pn_acoes_educativas e pa_atividades) no PostgreSQL.

Uso:
  python3 scripts/gerar-embeddings-progressao.py
"""

import os
import sys
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_batch
from sentence_transformers import SentenceTransformer

def load_env():
    if "DATABASE_URL" in os.environ:
        return os.environ["DATABASE_URL"]

    candidates = [
        Path.cwd() / ".env",
        Path.cwd() / "gebv" / ".env",
        Path(__file__).resolve().parent.parent / ".env",
    ]

    for p in candidates:
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DATABASE_URL="):
                        val = line.split("=", 1)[1].strip()
                        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                            val = val[1:-1]
                        return val
    return None

def main():
    db_url = load_env()
    if not db_url:
        print("ERRO: DATABASE_URL não encontrada no ambiente ou .env", file=sys.stderr)
        sys.exit(1)

    print("Conectando ao banco de dados PostgreSQL...")
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    try:
        # 1. Busca ações do Novo Programa (PN)
        cursor.execute("""
            SELECT a.id, b.nm_bloco, a.ds_acao
            FROM pn_acoes_educativas a
            JOIN pn_blocos b ON a.bloco_id = b.id
            ORDER BY a.id
        """)
        pn_rows = cursor.fetchall()
        print(f"Encontradas {len(pn_rows)} ações educativas do PN para calcular embedding.")

        # 2. Busca atividades do Programa Antigo (PA)
        cursor.execute("""
            SELECT 
                a.id, 
                COALESCE(a.identificacao, ''),
                COALESCE(c.nm_caminho, a.cd_caminho_paxtu, ''),
                COALESCE(comp.ds_competencia, ''),
                a.ds_atividade
            FROM pa_atividades a
            LEFT JOIN pa_caminhos c ON a.cd_caminho_paxtu = c.cd_caminho_paxtu
            LEFT JOIN pa_competencias comp ON a.competencia_id = comp.id
            ORDER BY a.id
        """)
        pa_rows = cursor.fetchall()
        print(f"Encontradas {len(pa_rows)} atividades do PA para calcular embedding.")

        print("\nCarregando modelo vetorial BAAI/bge-m3 (1024 dimensões)...")
        model = SentenceTransformer('BAAI/bge-m3')

        # 3. Processa e grava embeddings de PN
        if pn_rows:
            print("\nCalculando embeddings para ações educativas PN...")
            pn_ids = [r[0] for r in pn_rows]
            pn_texts = [f"{r[1]}: {r[2]}" for r in pn_rows]
            pn_embeddings = model.encode(pn_texts, batch_size=32, show_progress_bar=True, normalize_embeddings=True)

            print("Gravando embeddings de PN no banco de dados...")
            pn_update_data = [
                (emb.tolist(), acao_id)
                for acao_id, emb in zip(pn_ids, pn_embeddings)
            ]
            execute_batch(
                cursor,
                "UPDATE pn_acoes_educativas SET embedding = %s WHERE id = %s",
                pn_update_data,
                page_size=100
            )
            conn.commit()
            print(f"✓ {len(pn_update_data)} ações educativas PN atualizadas com sucesso.")

        # 4. Processa e grava embeddings de PA
        if pa_rows:
            print("\nCalculando embeddings para atividades PA...")
            pa_ids = [r[0] for r in pa_rows]
            pa_texts = [
                f"{r[1]} ({r[2]} - {r[3]}): {r[4]}" if r[1] or r[2] or r[3] else r[4]
                for r in pa_rows
            ]
            pa_embeddings = model.encode(pa_texts, batch_size=32, show_progress_bar=True, normalize_embeddings=True)

            print("Gravando embeddings de PA no banco de dados...")
            pa_update_data = [
                (emb.tolist(), ativ_id)
                for ativ_id, emb in zip(pa_ids, pa_embeddings)
            ]
            execute_batch(
                cursor,
                "UPDATE pa_atividades SET embedding = %s WHERE id = %s",
                pa_update_data,
                page_size=100
            )
            conn.commit()
            print(f"✓ {len(pa_update_data)} atividades PA atualizadas com sucesso.")

        print("\n🎉 Processo concluído com êxito! Embeddings gravados no PostgreSQL.")

    except Exception as e:
        conn.rollback()
        print(f"ERRO durante a execução: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()
