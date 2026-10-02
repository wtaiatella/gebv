#!/usr/bin/env python3
"""
Script autônomo offline para cálculo de embeddings 1024d com BAAI/bge-m3
para os itens de progressão (pn_acoes_educativas e pa_atividades) no PostgreSQL.

Uso:
  python3 scripts/gerar-embeddings-progressao.py
"""

import os
import sys
import argparse
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
    parser = argparse.ArgumentParser(description="Cálculo de embeddings 1024d para progressão (PN e PA)")
    parser.add_argument("--ramo", choices=["LOBINHO", "ESCOTEIRO", "SENIOR", "PIONEIRO", "ALL"], default="ALL",
                        help="Filtra por ramo específico (LOBINHO, ESCOTEIRO, etc.). Padrão: ALL")
    parser.add_argument("--only-missing", action="store_true", default=False,
                        help="Calcula apenas para registros sem embedding (cardinality = 0 ou NULL)")
    parser.add_argument("--force", action="store_true", default=False,
                        help="Força recálculo de todos os registros selecionados")
    args = parser.parse_args()

    db_url = load_env()
    if not db_url:
        print("ERRO: DATABASE_URL não encontrada no ambiente ou .env", file=sys.stderr)
        sys.exit(1)

    print("Conectando ao banco de dados PostgreSQL...")
    conn = psycopg2.connect(db_url)
    cursor = conn.cursor()

    try:
        pn_where_clauses = []
        pn_params = []
        pa_where_clauses = []
        pa_params = []

        if args.ramo and args.ramo != "ALL":
            pn_where_clauses.append("a.ds_ramo = %s")
            pn_params.append(args.ramo)
            pa_where_clauses.append("a.ds_ramo = %s")
            pa_params.append(args.ramo)

        if args.only_missing and not args.force:
            pn_where_clauses.append("(a.embedding IS NULL OR cardinality(a.embedding) = 0)")
            pa_where_clauses.append("(a.embedding IS NULL OR cardinality(a.embedding) = 0)")

        pn_where_sql = f"WHERE {' AND '.join(pn_where_clauses)}" if pn_where_clauses else ""
        pa_where_sql = f"WHERE {' AND '.join(pa_where_clauses)}" if pa_where_clauses else ""

        # 1. Busca ações do Novo Programa (PN)
        cursor.execute(f"""
            SELECT a.id, b.nm_bloco, a.ds_acao
            FROM pn_acoes_educativas a
            JOIN pn_blocos b ON a.bloco_id = b.id
            {pn_where_sql}
            ORDER BY a.id
        """, tuple(pn_params))
        pn_rows = cursor.fetchall()
        print(f"Encontradas {len(pn_rows)} ações educativas do PN para calcular embedding.")

        # 2. Busca atividades do Programa Antigo (PA)
        cursor.execute(f"""
            SELECT 
                a.id, 
                COALESCE(a.identificacao, ''),
                COALESCE(c.nm_caminho, a.cd_caminho_paxtu, ''),
                COALESCE(comp.ds_competencia, ''),
                a.ds_atividade
            FROM pa_atividades a
            LEFT JOIN pa_caminhos c ON a.cd_caminho_paxtu = c.cd_caminho_paxtu AND a.ds_ramo = c.ds_ramo
            LEFT JOIN pa_competencias comp ON a.competencia_id = comp.id
            {pa_where_sql}
            ORDER BY a.id
        """, tuple(pa_params))
        pa_rows = cursor.fetchall()
        print(f"Encontradas {len(pa_rows)} atividades do PA para calcular embedding.")

        total_itens = len(pn_rows) + len(pa_rows)
        if total_itens == 0:
            print("Nenhum item pendente de cálculo de embedding encontrado.")
            return

        print("\nCarregando modelo vetorial BAAI/bge-m3 (1024 dimensões)...")
        model = SentenceTransformer('BAAI/bge-m3')

        # 3. Processa e grava embeddings de PN
        if pn_rows:
            print(f"\nCalculando embeddings para {len(pn_rows)} ações educativas PN...")
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
            print(f"\nCalculando embeddings para {len(pa_rows)} atividades PA...")
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
