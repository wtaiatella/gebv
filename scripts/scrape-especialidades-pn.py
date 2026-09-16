#!/usr/bin/env python3
"""
Script de Coleta de Especialidades - Programa Novo (PN)
Fonte: Site oficial da União dos Escoteiros do Brasil (escoteiros.org.br)

Extrai dados completos de todas as especialidades do Programa Educativo Atualizado (Novo):
- Ramos: Lobinho/Escoteiro e Sênior/Pioneiro
- Áreas: Habilidades para a Vida, Meio Ambiente, Paz e Desenvolvimento, Saúde e Bem-Estar
- Título, Ramo, Área, URL, Imagem do Distintivo
- Suporte duplo de metodologia:
  * Lobinho e Escoteiro: Itens numerados (1 a 8) e níveis I e II
  * Sênior e Pioneiro: Sugestão de Temas e etapas (CONHECER, FAZER, COMPARTILHAR)
- Download das imagens dos distintivos para diretório local e public do Next.js
- Exportação em JSON estruturado pronto para sincronização com pn_especialidades

Uso:
  python3 gebv/scripts/scrape-especialidades-pn.py [--test] [--skip-images] [--concurrency 8]
"""

import os
import sys
import re
import time
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
DATA_DIR = os.path.join(GEBV_DIR, "data", "especialidades", "pn")
PUBLIC_IMG_DIR = os.path.join(GEBV_DIR, "public", "images", "especialidades", "pn")
LOCAL_IMG_DIR = os.path.join(DATA_DIR, "images")

PN_CATEGORIES = [
    # Ramos Lobinho e Escoteiro
    ("habilidades-para-a-vida", "Habilidades para a Vida", "lobinho_escoteiro"),
    ("meio-ambiente", "Meio Ambiente", "lobinho_escoteiro"),
    ("paz-e-desenvolvimento", "Paz e Desenvolvimento", "lobinho_escoteiro"),
    ("saude-e-bem-estar", "Saúde e Bem-Estar", "lobinho_escoteiro"),
    
    # Ramos Sênior e Pioneiro
    ("habilidades-para-a-vida-programa-educativo-atualizado-ramos-senior-e-pioneiro", "Habilidades para a Vida", "senior_pioneiro"),
    ("meio-ambiente-programa-educativo-atualizado-ramos-senior-e-pioneiro", "Meio Ambiente", "senior_pioneiro"),
    ("paz-e-desenvolvimento-programa-educativo-atualizado-ramos-senior-e-pioneiro", "Paz e Desenvolvimento", "senior_pioneiro"),
    ("saude-e-bem-estar-programa-educativo-atualizado-ramos-senior-e-pioneiro", "Saúde e Bem-Estar", "senior_pioneiro"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.escoteiros.org.br/especialidades/"
}

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

def fetch_category_page(category_slug, area_name, ramo, page_num):
    """Busca uma página do catálogo via admin-ajax.php com retry."""
    url = "https://www.escoteiros.org.br/wp-admin/admin-ajax.php"
    data = urllib.parse.urlencode({
        "action": "filter",
        "tipo": "especialidade",
        "taxonomy": "CategoriaEspecialidade",
        "category": category_slug,
        "page": page_num
    }).encode()
    
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS)
            resp = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="ignore")
            break
        except Exception as e:
            if attempt == 2:
                raise e
            time.sleep(1.5)
            
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
        
        slug = href.rstrip("/").split("/")[-1] if href else ""
        
        if href and title:
            cards.append({
                "slug": slug,
                "titulo": title,
                "url": href,
                "thumb_url": thumb_url,
                "area": area_name,
                "slug_categoria": category_slug,
                "ramo": ramo
            })
            
    return max_page, cards

def discover_all_specialties(test_mode=False):
    """Descobre todas as especialidades de todas as categorias e ramos do Programa Novo."""
    all_specialties = {}
    print("Iniciando descoberta do catálogo via admin-ajax.php (Programa Novo)...")
    
    for cat_slug, area_name, ramo in PN_CATEGORIES:
        label = f"{area_name} ({ramo})"
        max_page, first_cards = fetch_category_page(cat_slug, area_name, ramo, 1)
        for card in first_cards:
            all_specialties[card["url"]] = card
            
        print(f"  > [{label}] {len(first_cards)} itens na pág 1 (total de páginas: {max_page})")
        
        if test_mode:
            continue
            
        if max_page > 1:
            for p in range(2, max_page + 1):
                _, cards = fetch_category_page(cat_slug, area_name, ramo, p)
                for card in cards:
                    all_specialties[card["url"]] = card
                    
    results = list(all_specialties.values())
    print(f"Total de especialidades únicas descobertas no Programa Novo: {len(results)}\n")
    return results

def extract_items_lob_esc(content_div):
    """Extrai itens numerados do ramo Lobinho e Escoteiro."""
    items = []
    
    # Estratégia 1: Parágrafos numerados (ex: "1. ", "2. ")
    p_numbered = []
    for p in content_div.find_all("p"):
        txt = clean_text(p.get_text())
        m = re.match(r"^(\d+)[\.\-\)]\s*(.*)$", txt)
        if m:
            num = int(m.group(1))
            body = m.group(2).strip()
            if not any(body.startswith(x) for x in ["Nível", "Nivel", "Compartilhe", "O jovem tem"]):
                p_numbered.append((num, body))
                
    if p_numbered and len(p_numbered) >= 3:
        for num, body in p_numbered:
            items.append({
                "nr_item": num,
                "cd_item": str(num),
                "ds_item": body
            })
        return items

    # Estratégia 2: Tags <li>
    lis = content_div.find_all("li")
    if lis:
        for i, li in enumerate(lis, 1):
            txt = clean_text(li.get_text())
            txt_clean = re.sub(r"^\d+[\.\-\)]\s*", "", txt)
            if len(txt_clean) > 5:
                items.append({
                    "nr_item": i,
                    "cd_item": str(i),
                    "ds_item": txt_clean
                })
        return items

    return items

def extract_items_sen_pio(content_div):
    """Extrai temas e ações do ramo Sênior e Pioneiro (Sugestão de Temas, Conhecer, Fazer, Compartilhar)."""
    items = []
    current_section = "GERAL"
    item_num = 1
    temas = []
    
    for el in content_div.find_all(["p", "li"]):
        txt = clean_text(el.get_text())
        if not txt:
            continue
            
        upper_txt = txt.upper()
        if "SUGESTÃO DE TEMAS" in upper_txt or "SUGESTAO DE TEMAS" in upper_txt:
            current_section = "TEMAS"
            continue
        elif upper_txt == "CONHECER" or upper_txt.startswith("CONHECER:"):
            current_section = "CONHECER"
            continue
        elif upper_txt == "FAZER" or upper_txt.startswith("FAZER:"):
            current_section = "FAZER"
            continue
        elif upper_txt == "COMPARTILHAR" or upper_txt.startswith("COMPARTILHAR:"):
            current_section = "COMPARTILHAR"
            continue
            
        # Pula parágrafos introdutórios genéricos
        if any(txt.startswith(x) for x in ["Escolha uma temática", "Com base nos aprendizados", "Compartilhe seus saberes"]):
            continue
            
        if current_section == "TEMAS":
            temas.append(txt)
        elif current_section in ["CONHECER", "FAZER", "COMPARTILHAR"]:
            # Remove bullet point inicial
            clean_body = re.sub(r"^[•\-\*\.]\s*", "", txt).strip()
            if len(clean_body) > 10:
                items.append({
                    "nr_item": item_num,
                    "cd_item": str(item_num),
                    "etapa": current_section,
                    "ds_item": clean_body
                })
                item_num += 1

    return items, temas

def extract_specialty_detail(item_meta):
    """Baixa a página da especialidade com retry e extrai os metadados completos."""
    url = item_meta["url"]
    slug = item_meta["slug"]
    ramo = item_meta["ramo"]
    
    html = ""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
            html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="ignore")
            break
        except Exception as e:
            if attempt == 2:
                raise e
            time.sleep(1.5)
            
    soup = BeautifulSoup(html, "html.parser")
    
    # Imagem do distintivo
    badge_url = item_meta.get("thumb_url", "")
    badge_img = soup.find("img", class_="badge-image")
    if badge_img and badge_img.get("src"):
        badge_url = badge_img.get("src").strip()
        
    # Extrai níveis de exigência se declarados no texto
    full_text = clean_text(soup.get_text())
    niveis = None
    niveis_match = re.search(r"N[ií]veis da Especialidade\s*(.*?)(?:O jovem tem|Compartilhe|$)", full_text, re.I)
    if niveis_match:
        niveis_raw = niveis_match.group(1).strip()
        niveis = {"descricao": niveis_raw}
        n1 = re.search(r"N[ií]vel\s*I\s*(\d+)\s*itens", niveis_raw, re.I)
        n2 = re.search(r"N[ií]vel\s*II\s*(\d+)\s*itens", niveis_raw, re.I)
        if n1:
            niveis["nivel_1_itens"] = int(n1.group(1))
        if n2:
            niveis["nivel_2_itens"] = int(n2.group(1))
            
    # Extrai requisitos da área .content__text
    items = []
    temas = []
    content_div = soup.find(class_=lambda c: c and "content__text" in c)
    if content_div:
        if ramo == "senior_pioneiro":
            items, temas = extract_items_sen_pio(content_div)
            if not items:
                items = extract_items_lob_esc(content_div)
        else:
            items = extract_items_lob_esc(content_div)
            if not items:
                items, temas = extract_items_sen_pio(content_div)

    result = {
        "slug": slug,
        "titulo": item_meta["titulo"],
        "ds_especialidade": item_meta["titulo"],
        "ds_area": item_meta["area"],
        "slug_categoria": item_meta["slug_categoria"],
        "ramo": ramo,
        "url": url,
        "imagem_url": badge_url,
        "total_itens": len(items),
        "niveis": niveis,
        "itens": items
    }
    if temas:
        result["sugestao_temas"] = temas
        
    return result

def download_image(img_url, dest_paths):
    """Baixa a imagem de forma segura com suporte a URLs codificadas e retries."""
    if not img_url:
        return False
    encoded_url = safe_url(img_url)
    for attempt in range(3):
        try:
            req = urllib.request.Request(encoded_url, headers={"User-Agent": HEADERS["User-Agent"]})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                for path in dest_paths:
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(data)
            return True
        except Exception as e:
            if attempt == 2:
                print(f"    [ERRO IMAGEM] Falha ao baixar {img_url}: {e}")
                return False
            time.sleep(1.0)
    return False

def main():
    parser = argparse.ArgumentParser(description="Scraper de Especialidades do Programa Novo (PN)")
    parser.add_argument("--test", action="store_true", help="Executa apenas para uma amostra reduzida")
    parser.add_argument("--skip-images", action="store_true", help="Pula download de imagens se já existirem")
    parser.add_argument("--concurrency", type=int, default=8, help="Número de threads simultâneas (padrão: 8)")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(LOCAL_IMG_DIR, exist_ok=True)
    os.makedirs(PUBLIC_IMG_DIR, exist_ok=True)

    catalog = discover_all_specialties(test_mode=args.test)
    if args.test:
        catalog = catalog[:6]
        print(f"[MODO TESTE] Processando apenas as primeiras {len(catalog)} especialidades...")

    print(f"Baixando detalhes e imagens do Programa Novo com {args.concurrency} threads...")
    full_data = []
    
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        future_to_item = {executor.submit(extract_specialty_detail, item): item for item in catalog}
        
        for future in as_completed(future_to_item):
            orig_meta = future_to_item[future]
            try:
                detail = future.result()
                
                ext = ".png"
                if detail["imagem_url"]:
                    clean_url = detail["imagem_url"].split("?")[0]
                    _, file_ext = os.path.splitext(clean_url)
                    if file_ext in [".png", ".jpg", ".jpeg", ".webp", ".svg"]:
                        ext = file_ext
                
                filename = f"{detail['slug']}{ext}"
                detail["imagem_arquivo"] = filename
                detail["imagem_caminho_public"] = f"/images/especialidades/pn/{filename}"
                
                local_path = os.path.join(LOCAL_IMG_DIR, filename)
                public_path = os.path.join(PUBLIC_IMG_DIR, filename)
                
                if not args.skip_images or not os.path.exists(public_path):
                    download_image(detail["imagem_url"], [local_path, public_path])
                
                full_data.append(detail)
                ramo_str = "Lob/Esc" if detail["ramo"] == "lobinho_escoteiro" else "Sên/Pio"
                temas_str = f" [{len(detail.get('sugestao_temas', []))} temas]" if "sugestao_temas" in detail else ""
                print(f"  ✓ [{ramo_str}] {detail['titulo']} ({detail['total_itens']} itens{temas_str}) [{detail['ds_area']}]")
            except Exception as e:
                print(f"  ✗ Erro em {orig_meta['titulo']}: {e}")

    # Deduplica especialidades idênticas do portal por (titulo, ramo)
    deduped_data = {}
    for item in full_data:
        key = (item["titulo"].strip(), item["ramo"])
        if key in deduped_data:
            print(f"  [DEDUPLICAÇÃO] Ignorando post duplicado do portal: {item['slug']} ({item['titulo']} / {item['ramo']})")
            continue
        deduped_data[key] = item
    full_data = list(deduped_data.values())

    # Ordena por ramo e título
    full_data.sort(key=lambda x: (x["ramo"], x["titulo"]))

    output_json_path = os.path.join(DATA_DIR, "especialidades_pn.json")
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    specs_data_dir = os.path.join(GEBV_DIR, "..", "docs", "specs", "2026-09-15-especialidades", "data", "pn")
    os.makedirs(specs_data_dir, exist_ok=True)
    with open(os.path.join(specs_data_dir, "especialidades_pn.json"), "w", encoding="utf-8") as f:
        json.dump(full_data, f, ensure_ascii=False, indent=2)

    print("\n=======================================================")
    print(f"Concluído! Total processado no Programa Novo: {len(full_data)} especialidades.")
    print(f"JSON salvo em:")
    print(f"  - {output_json_path}")
    print(f"  - {os.path.join(specs_data_dir, 'especialidades_pn.json')}")
    print(f"Imagens salvas em:")
    print(f"  - {LOCAL_IMG_DIR}")
    print(f"  - {PUBLIC_IMG_DIR}")
    print("=======================================================")

if __name__ == "__main__":
    main()
