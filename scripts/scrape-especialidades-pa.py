#!/usr/bin/env python3
"""
Script de Coleta de Especialidades - Programa Antigo (PA)
Fonte: Site oficial da União dos Escoteiros do Brasil (escoteiros.org.br)

Extrai dados completos de todas as especialidades do Programa Antigo:
- Título, Área/Grupo, URL, Imagem do Distintivo
- Lista detalhada de itens de requisitos
- Mapeamento com códigos conhecidos do Paxtu (para as 114 já existentes)
- Download das imagens dos distintivos para diretório local e public do Next.js
- Exportação em JSON estruturado

Uso:
  python3 gebv/scripts/scrape-especialidades-pa.py [--test] [--skip-images] [--concurrency 8]
"""

import os
import sys
import re
import json
import argparse
import unicodedata
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup

# Configurações de diretórios
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GEBV_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(GEBV_DIR, "data", "especialidades", "pa")
PUBLIC_IMG_DIR = os.path.join(GEBV_DIR, "public", "images", "especialidades", "pa")
LOCAL_IMG_DIR = os.path.join(DATA_DIR, "images")
PA_CATALOG_DB = os.path.join(GEBV_DIR, "data", "pa_especialidades_catalogo.json")

# Categorias do Programa Antigo na taxonomia CategoriaEspecialidade
PA_CATEGORIES = [
    ("ciencia-e-tecnologia", "Ciência e Tecnologia"),
    ("cultura", "Cultura"),
    ("desportos", "Desportos"),
    ("habilidades-escoteiras", "Habilidades Escoteiras"),
    ("servicos", "Serviços"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.escoteiros.org.br/especialidades/"
}

def normalize_name(text: str) -> str:
    """Normaliza texto para cruzamento de chaves (sem acentos, minúsculo, sem pontuação)."""
    text = re.sub(r"\(revisada\)|\(antigo[^\)]*\)", "", text, flags=re.I)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z0-9]+", " ", text).strip().lower()

def clean_text(text: str) -> str:
    """Remove quebras extras e normaliza espaços em branco."""
    return re.sub(r"\s+", " ", text).strip()

def safe_url(url: str) -> str:
    """Garante que caracteres não-ASCII em URLs sejam codificados em percent-encoding."""
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)
    encoded_path = urllib.parse.quote(parts.path)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, encoded_path, parts.query, parts.fragment))

def load_existing_db_codes():
    """Carrega códigos Paxtu existentes a partir do catálogo local."""
    codes_map = {}
    if os.path.exists(PA_CATALOG_DB):
        try:
            with open(PA_CATALOG_DB, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    norm_k = normalize_name(item.get("ds_especialidade", ""))
                    codes_map[norm_k] = item.get("cd_especialidade")
        except Exception as e:
            print(f"[AVISO] Não foi possível ler {PA_CATALOG_DB}: {e}")
    return codes_map

def find_paxtu_code(title: str, slug: str, codes_map: dict):
    """Localiza código Paxtu por nome exato normalizado."""
    n_title = normalize_name(title)
    n_slug = normalize_name(slug)
    if n_title in codes_map:
        return codes_map[n_title]
    if n_slug in codes_map:
        return codes_map[n_slug]
    
    manual_map = {
        normalize_name("Animais Peçonhentos"): "238",
        normalize_name("Quebra-Cabeça"): "271",
        normalize_name("Gênero Musical (antigo Rock)"): "248",
        "rock": "248",
    }
    if n_title in manual_map:
        return manual_map[n_title]
    if n_slug in manual_map:
        return manual_map[n_slug]
    return None

def fetch_category_page(category_slug, category_name, page_num):
    """Busca uma página do catálogo via admin-ajax.php."""
    url = "https://www.escoteiros.org.br/wp-admin/admin-ajax.php"
    data = urllib.parse.urlencode({
        "action": "filter",
        "tipo": "especialidade",
        "taxonomy": "CategoriaEspecialidade",
        "category": category_slug,
        "page": page_num
    }).encode()
    
    req = urllib.request.Request(url, data=data, headers=HEADERS)
    resp = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
    
    # Detecta página máxima
    p_matches = re.findall(r"data-max-page=[\"'](\d+)[\"']", resp)
    max_page = int(p_matches[0]) if p_matches else 1
    
    cards = []
    soup = BeautifulSoup(resp, "html.parser")
    for link_tag in soup.find_all("a", class_="card-badge-link"):
        href = link_tag.get("href", "").strip()
        title_tag = link_tag.find(class_="card-title")
        title = clean_text(title_tag.get_text()) if title_tag else ""
        img_tag = link_tag.find("img")
        thumb_url = img_tag.get("src", "").strip() if img_tag else ""
        
        # Extrai slug da URL
        slug = href.rstrip("/").split("/")[-1] if href else ""
        
        if href and title:
            cards.append({
                "slug": slug,
                "titulo": title,
                "url": href,
                "thumb_url": thumb_url,
                "grupo": category_name,
                "slug_grupo": category_slug,
            })
            
    return max_page, cards

def discover_all_specialties(test_mode=False):
    """Descobre todas as especialidades de todas as 5 categorias do Programa Antigo."""
    all_specialties = {}
    print("Iniciando descoberta do catálogo via admin-ajax.php (Programa Antigo)...")
    
    for cat_slug, cat_name in PA_CATEGORIES:
        max_page, first_cards = fetch_category_page(cat_slug, cat_name, 1)
        for card in first_cards:
            all_specialties[card["url"]] = card
            
        print(f"  > [{cat_name}] {len(first_cards)} itens na pág 1 (total de páginas: {max_page})")
        
        if test_mode:
            continue
            
        if max_page > 1:
            for p in range(2, max_page + 1):
                _, cards = fetch_category_page(cat_slug, cat_name, p)
                for card in cards:
                    all_specialties[card["url"]] = card
                    
    results = list(all_specialties.values())
    print(f"Total de especialidades únicas descobertas: {len(results)}\n")
    return results

def extract_specialty_detail(item_meta):
    """Baixa a página da especialidade e extrai os itens e imagem em alta resolução."""
    url = item_meta["url"]
    slug = item_meta["slug"]
    
    req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
    html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
    soup = BeautifulSoup(html, "html.parser")
    
    # Imagem do distintivo
    badge_url = item_meta.get("thumb_url", "")
    badge_img = soup.find("img", class_="badge-image")
    if badge_img and badge_img.get("src"):
        badge_url = badge_img.get("src").strip()
        
    # Extrai requisitos da área .content__text
    items = []
    content_div = soup.find(class_=lambda c: c and "content__text" in c)
    if content_div:
        # Formato 1: tags <li>
        lis = content_div.find_all("li")
        clean_lis = [clean_text(li.get_text()) for li in lis if len(clean_text(li.get_text())) > 5]
        
        if clean_lis:
            for i, it in enumerate(clean_lis, 1):
                it_clean = re.sub(r"^\d+[\.\-\)]\s*", "", it)
                items.append({
                    "cd_item": str(i),
                    "nr_item": i,
                    "ds_item": it_clean
                })
        else:
            # Formato 2: parágrafos <p> numerados
            ps = content_div.find_all("p")
            item_num = 1
            for p in ps:
                txt = clean_text(p.get_text())
                if not txt or any(txt.startswith(x) for x in ["Nível", "Nivel", "Compartilhe", "O jovem tem"]):
                    continue
                txt_clean = re.sub(r"^\d+[\.\-\)]\s*", "", txt)
                items.append({
                    "cd_item": str(item_num),
                    "nr_item": item_num,
                    "ds_item": txt_clean
                })
                item_num += 1

    return {
        "slug": slug,
        "titulo": item_meta["titulo"],
        "grupo": item_meta["grupo"],
        "slug_grupo": item_meta["slug_grupo"],
        "url": url,
        "imagem_url": badge_url,
        "total_itens": len(items),
        "itens": items
    }

def download_image(img_url, dest_paths):
    """Baixa a imagem de forma segura com suporte a URLs codificadas."""
    if not img_url:
        return False
    try:
        encoded_url = safe_url(img_url)
        req = urllib.request.Request(encoded_url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            for path in dest_paths:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(data)
        return True
    except Exception as e:
        print(f"    [ERRO IMAGEM] Falha ao baixar {img_url}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Scraper de Especialidades do Programa Antigo (PA)")
    parser.add_argument("--test", action="store_true", help="Executa apenas para uma amostra reduzida (página 1)")
    parser.add_argument("--skip-images", action="store_true", help="Pula download de imagens se já existirem")
    parser.add_argument("--concurrency", type=int, default=8, help="Número de threads simultâneas (padrão: 8)")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(LOCAL_IMG_DIR, exist_ok=True)
    os.makedirs(PUBLIC_IMG_DIR, exist_ok=True)

    db_codes = load_existing_db_codes()
    print(f"Códigos Paxtu conhecidos no banco local: {len(db_codes)} especialidades.")

    catalog = discover_all_specialties(test_mode=args.test)
    if args.test:
        catalog = catalog[:5]
        print(f"[MODO TESTE] Processando apenas as primeiras {len(catalog)} especialidades...")

    print(f"Baixando detalhes e imagens com {args.concurrency} threads...")
    full_data = []
    
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        future_to_item = {executor.submit(extract_specialty_detail, item): item for item in catalog}
        
        for future in as_completed(future_to_item):
            orig_meta = future_to_item[future]
            try:
                detail = future.result()
                paxtu_code = find_paxtu_code(detail["titulo"], detail["slug"], db_codes)
                detail["cd_especialidade"] = paxtu_code if paxtu_code else f"WEB-{detail['slug']}"
                
                # Define arquivo de imagem
                ext = ".png"
                if detail["imagem_url"]:
                    clean_url = detail["imagem_url"].split("?")[0]
                    _, file_ext = os.path.splitext(clean_url)
                    if file_ext in [".png", ".jpg", ".jpeg", ".webp", ".svg"]:
                        ext = file_ext
                
                filename = f"{detail['slug']}{ext}"
                detail["imagem_arquivo"] = filename
                detail["imagem_caminho_public"] = f"/images/especialidades/pa/{filename}"
                
                # Download de imagens
                local_path = os.path.join(LOCAL_IMG_DIR, filename)
                public_path = os.path.join(PUBLIC_IMG_DIR, filename)
                
                if not args.skip_images or not os.path.exists(public_path):
                    download_image(detail["imagem_url"], [local_path, public_path])
                
                full_data.append(detail)
                match_str = f"[Paxtu CD: {paxtu_code}]" if paxtu_code else "[Novo/Sem Paxtu]"
                print(f"  ✓ {detail['titulo']} ({detail['total_itens']} itens) {match_str}")
            except Exception as e:
                print(f"  ✗ Erro em {orig_meta['titulo']}: {e}")

    # Ordena alfabeticamente
    full_data.sort(key=lambda x: x["titulo"])

    # Salva o arquivo JSON consolidado
    output_json_path = os.path.join(DATA_DIR, "especialidades_pa.json")
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    # Salva também uma cópia no diretório de specs para documentação
    specs_data_dir = os.path.join(GEBV_DIR, "..", "docs", "specs", "2026-09-15-especialidades", "data", "pa")
    os.makedirs(specs_data_dir, exist_ok=True)
    with open(os.path.join(specs_data_dir, "especialidades_pa.json"), "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    print("\n=======================================================")
    print(f"Concluído! Total processado: {len(full_data)} especialidades.")
    print(f"JSON salvo em:")
    print(f"  - {output_json_path}")
    print(f"  - {os.path.join(specs_data_dir, 'especialidades_pa.json')}")
    print(f"Imagens salvas em:")
    print(f"  - {LOCAL_IMG_DIR}")
    print(f"  - {PUBLIC_IMG_DIR}")
    print("=======================================================")

if __name__ == "__main__":
    main()
