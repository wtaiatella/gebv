#!/usr/bin/env python3
"""
Script autônomo offline para cálculo de embeddings 1024d com BAAI/bge-m3
para os itens de especialidades PA e PN no PostgreSQL.

Uso:
  python3 scripts/gerar-embeddings-especialidades.py
"""

import os
import sys
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_batch
from sentence_transformers import SentenceTransformer

def load_env():
    # Tenta ler .env se DATABASE_URL não estiver no ambiente
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
        # 1. Busca itens de Especialidades PA
        cursor.execute("SELECT id, ds_item FROM pa_especialidades_itens ORDER BY id")
        pa_rows = cursor.fetchall()
        print(f"Encontrados {len(pa_rows)} itens de PA para calcular embedding.")

        # 2. Busca itens de Especialidades PN
        cursor.execute("SELECT id, ds_item FROM pn_especialidades_itens ORDER BY id")
        pn_rows = cursor.fetchall()
        print(f"Encontrados {len(pn_rows)} itens de PN para calcular embedding.")

        total_itens = len(pa_rows) + len(pn_rows)
        if total_itens == 0:
            print("Nenhum item encontrado no catálogo. Execute o seed primeiro.")
            return

        # 3. Carrega modelo BAAI/bge-m3
        model_name = "BAAI/bge-m3"
        print(f"Carregando modelo {model_name} via sentence-transformers...")
        model = SentenceTransformer(model_name)
        print("Modelo carregado com sucesso (dimensão 1024).")

        # 4. Processa PA
        if pa_rows:
            pa_ids = [r[0] for r in pa_rows]
            pa_texts = [r[1] or "" for r in pa_rows]
            print(f"Calculando embeddings para {len(pa_texts)} itens PA...")
            pa_embeddings = model.encode(
                pa_texts,
                batch_size=64,
                show_progress_bar=True,
                normalize_embeddings=True,
            )

            print("Persistindo embeddings de PA no PostgreSQL...")
            pa_update_data = [
                (emb.tolist(), item_id)
                for item_id, emb in zip(pa_ids, pa_embeddings)
            ]
            execute_batch(
                cursor,
                "UPDATE pa_especialidades_itens SET embedding = %s WHERE id = %s",
                pa_update_data,
                page_size=200,
            )
            conn.commit()
            print(f"✓ {len(pa_update_data)} embeddings de PA gravados com sucesso.")

        # 5. Processa PN
        if pn_rows:
            pn_ids = [r[0] for r in pn_rows]
            pn_texts = [r[1] or "" for r in pn_rows]
            print(f"Calculando embeddings para {len(pn_texts)} itens PN...")
            pn_embeddings = model.encode(
                pn_texts,
                batch_size=64,
                show_progress_bar=True,
                normalize_embeddings=True,
            )

            print("Persistindo embeddings de PN no PostgreSQL...")
            pn_update_data = [
                (emb.tolist(), item_id)
                for item_id, emb in zip(pn_ids, pn_embeddings)
            ]
            execute_batch(
                cursor,
                "UPDATE pn_especialidades_itens SET embedding = %s WHERE id = %s",
                pn_update_data,
                page_size=200,
            )
            conn.commit()
            print(f"✓ {len(pn_update_data)} embeddings de PN gravados com sucesso.")

        print(f"★ GERAÇÃO DE EMBEDDINGS CONCLUÍDA: {total_itens} VETORES GRAVADOS COM SUCESSO! ★")

    except Exception as e:
        conn.rollback()
        print(f"ERRO durante o cálculo ou persistência de embeddings: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()
