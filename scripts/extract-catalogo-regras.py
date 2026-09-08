#!/usr/bin/env python3
"""
Extrator de Catálogo e Regras de Equivalência do Ramo Escoteiro
Lê as planilhas Excel e gera arquivos JSON estruturados em data/catalogo/
"""

import os
import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DOCS_DIR = os.path.join(BASE_DIR, 'docs')
OUT_DIR = os.path.join(BASE_DIR, 'data', 'catalogo')
os.makedirs(OUT_DIR, exist_ok=True)

FILE_EQUIV = os.path.join(DOCS_DIR, 'Planilha Equivalência Ramo Escoteiro .xlsx')
FILE_NOVO = os.path.join(DOCS_DIR, 'Progressão Escoteiro - Novo Programa.xlsx')
FILE_PROG_SAMPLE = os.path.join(BASE_DIR, 'data', 'progressoes.json')

def load_xlsx_data(file_path):
    """Carrega strings compartilhadas, abas e XMLs de um arquivo XLSX."""
    with zipfile.ZipFile(file_path, 'r') as z:
        sst = []
        if 'xl/sharedStrings.xml' in z.namelist():
            sst_xml = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in sst_xml.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                texts = [t.text for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if t.text]
                sst.append(''.join(texts))

        wb_xml = ET.fromstring(z.read('xl/workbook.xml'))
        sheets = wb_xml.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet')
        rels_xml = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rel_map = {r.attrib['Id']: r.attrib['Target'] for r in rels_xml.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship')}

        sheets_dict = {}
        for s in sheets:
            name = s.attrib['name']
            r_id = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rel_map.get(r_id, '')
            s_path = 'xl/' + target if not target.startswith('xl/') else target
            
            root = ET.fromstring(z.read(s_path))
            ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            
            rows = {}
            for row in root.findall(f'{ns}sheetData/{ns}row'):
                r_idx = int(row.attrib.get('r'))
                row_cells = {}
                for c in row.findall(f'{ns}c'):
                    cell_ref = c.attrib.get('r')
                    t = c.attrib.get('t')
                    v = c.find(f'{ns}v')
                    f = c.find(f'{ns}f')
                    val = v.text if v is not None else ''
                    if t == 's' and val.isdigit():
                        val = sst[int(val)]
                    formula = f.text if f is not None else ''
                    # Extrai letra da coluna
                    col_letter = re.sub(r'[0-9]', '', cell_ref)
                    row_cells[col_letter] = {'val': val, 'formula': formula, 'ref': cell_ref}
                rows[r_idx] = row_cells
            sheets_dict[name] = rows
            
        return sheets_dict

print("1. Extraindo catálogo do Programa Antigo (Paxtu / Pistas / Rumo)...")
equiv_sheets = load_xlsx_data(FILE_EQUIV)

# 1.1 Catálogo Antigo
pa_caminhos_def = [
    {'cd_caminho_paxtu': '4', 'nm_caminho': 'Período Introdutório'},
    {'cd_caminho_paxtu': '5', 'nm_caminho': 'Pistas e Trilha'},
    {'cd_caminho_paxtu': '6', 'nm_caminho': 'Rumo e Travessia'}
]

pa_areas = ['Desenvolvimento físico', 'Desenvolvimento intelectual', 'Desenvolvimento do caráter', 
            'Desenvolvimento afetivo', 'Desenvolvimento social', 'Desenvolvimento espiritual']

# Mapear competências e atividades do Paxtu sample
pa_atividades_map = {}
pa_competencias_map = {}

if os.path.exists(FILE_PROG_SAMPLE):
    with open(FILE_PROG_SAMPLE, 'r', encoding='utf-8') as f:
        prog_sample = json.load(f)
        if prog_sample and len(prog_sample) > 0:
            for c in prog_sample[0].get('caminhos', []):
                c_data = c.get('data', [])
                for atv in c_data:
                    c_id = atv.get('cdCaminho')
                    comp_id = atv.get('cdCompetencia')
                    atv_id = atv.get('cdAtividade')
                    ueb = atv.get('cdUeb')
                    ds = atv.get('dsAtividade')
                    area = atv.get('dsDesenvolvimento') or 'Desenvolvimento físico'
                    
                    if comp_id and comp_id not in pa_competencias_map:
                        pa_competencias_map[comp_id] = {
                            'cd_competencia_paxtu': comp_id,
                            'cd_caminho_paxtu': c_id,
                            'ds_area': area,
                            'ds_competencia': ''
                        }
                    
                    if atv_id:
                        pa_atividades_map[f"{c_id}_{ueb}"] = {
                            'cd_atividade_paxtu': atv_id,
                            'cd_caminho_paxtu': c_id,
                            'cd_competencia_paxtu': comp_id,
                            'cd_ueb': ueb,
                            'nr_ordenacao': int(atv.get('cdOrdenacao') or 0),
                            'ds_atividade': ds,
                            'ds_area': area
                        }

# Complementar textos de competências a partir das abas 'Pistas e Trilha' e 'Rumo e Travessia'
def parse_antigo_sheet(sheet_name, caminho_id):
    sheet = equiv_sheets.get(sheet_name, {})
    current_area = 'Desenvolvimento físico'
    current_competencia = ''
    items = []
    
    for r_idx in sorted(sheet.keys()):
        row = sheet[r_idx]
        c_val = row.get('C', {}).get('val', '').strip()
        b_val = row.get('B', {}).get('val', '').strip()
        
        if not c_val:
            continue
            
        # Detecta título de área
        upper = c_val.upper()
        if 'FÍSICO' in upper or 'FISICO' in upper:
            current_area = 'Desenvolvimento físico'
            continue
        elif 'INTELECTUAL' in upper:
            current_area = 'Desenvolvimento intelectual'
            continue
        elif 'CARÁTER' in upper or 'CARATER' in upper:
            current_area = 'Desenvolvimento do caráter'
            continue
        elif 'AFETIVO' in upper:
            current_area = 'Desenvolvimento afetivo'
            continue
        elif 'SOCIAL' in upper:
            current_area = 'Desenvolvimento social'
            continue
        elif 'ESPIRITUAL' in upper:
            current_area = 'Desenvolvimento espiritual'
            continue
            
        # Se não tem índice em B (ou B vazio), é competência
        if not b_val and len(c_val) > 20:
            current_competencia = c_val
        elif b_val:
            # É atividade sugerida com número
            items.append({
                'excel_row': r_idx,
                'cd_caminho_paxtu': caminho_id,
                'cd_ueb': b_val,
                'ds_competencia': current_competencia,
                'ds_area': current_area,
                'ds_atividade': c_val
            })
    return items

pistas_items = parse_antigo_sheet('Pistas e Trilha', '5')
rumo_items = parse_antigo_sheet('Rumo e Travessia', '6')

# Adiciona Período Introdutório (caminho 4, P1 a P10)
intro_items = []
if os.path.exists(FILE_PROG_SAMPLE):
    with open(FILE_PROG_SAMPLE, 'r', encoding='utf-8') as f:
        prog_sample = json.load(f)
        if prog_sample and len(prog_sample) > 0:
            for c in prog_sample[0].get('caminhos', []):
                for atv in c.get('data', []):
                    if atv.get('cdCaminho') == '4':
                        intro_items.append({
                            'excel_row': 0,
                            'cd_caminho_paxtu': '4',
                            'cd_ueb': atv.get('cdUeb'),
                            'ds_competencia': 'Período Introdutório e Integração',
                            'ds_area': 'Desenvolvimento do caráter',
                            'ds_atividade': atv.get('dsAtividade')
                        })

pa_catalogo = {
    'caminhos': pa_caminhos_def,
    'areas': pa_areas,
    'intro_items': intro_items,
    'pistas_items': pistas_items,
    'rumo_items': rumo_items,
    'atividades_map': pa_atividades_map
}

with open(os.path.join(OUT_DIR, 'pa_catalogo.json'), 'w', encoding='utf-8') as f:
    json.dump(pa_catalogo, f, ensure_ascii=False, indent=2)

print(f"✓ Catálogo Antigo gerado: {len(pistas_items)} itens em Pistas, {len(rumo_items)} itens em Rumo.")

# 2. Extraindo Catálogo do Novo Programa (18 Blocos e Ações Educativas)
print("2. Extraindo catálogo do Novo Programa Educativo (18 Blocos)...")
novo_sheets = load_xlsx_data(FILE_NOVO)
prog_pessoal = novo_sheets.get('Progressão Pessoal', {})

# 2.1 Eixos e Blocos
blocos_meta = {}
for r_idx in range(4, 22):
    row = prog_pessoal.get(r_idx, {})
    eixo = row.get('A', {}).get('val', '').strip()
    bloco = row.get('B', {}).get('val', '').strip()
    fixa = int(float(row.get('C', {}).get('val', '0') or 0))
    var_total = int(float(row.get('D', {}).get('val', '0') or 0))
    var_meta = int(float(row.get('E', {}).get('val', '0') or 0))
    subst = int(float(row.get('F', {}).get('val', '0') or 0))
    total_realizar = int(float(row.get('G', {}).get('val', '0') or 0))
    
    if eixo and bloco:
        blocos_meta[bloco] = {
            'eixo': eixo,
            'bloco': bloco,
            'nr_acoes_fixas_obrigatorias': fixa,
            'nr_acoes_variaveis_total': var_total,
            'nr_acoes_variaveis_exigidas': var_meta,
            'total_realizar': total_realizar,
            'nr_ordem': r_idx - 3
        }

# 2.2 Ações Educativas
pn_acoes = []
bloco_intencionalidades = {}

for r_idx in range(24, 300):
    row = prog_pessoal.get(r_idx, {})
    if not row:
        continue
    eixo = row.get('A', {}).get('val', '').strip()
    bloco = row.get('B', {}).get('val', '').strip()
    intencionalidade = row.get('C', {}).get('val', '').strip()
    tp_acao = row.get('H', {}).get('val', '').strip() # Fixa, Variável, Substitui variável
    acao_texto = row.get('I', {}).get('val', '').strip()
    modalidade = row.get('N', {}).get('val', '').strip() or 'Básico'
    regra_qtd = row.get('O', {}).get('val', '').strip()
    
    if not eixo or not bloco or not acao_texto:
        continue
        
    if bloco not in bloco_intencionalidades and intencionalidade:
        bloco_intencionalidades[bloco] = intencionalidade
        
    pn_acoes.append({
        'excel_row': r_idx,
        'eixo': eixo,
        'bloco': bloco,
        'tp_acao': tp_acao,
        'modalidade': modalidade,
        'ds_acao': acao_texto,
        'regra_qtd_texto': regra_qtd
    })

# Atribui intencionalidade aos blocos
for bloco_nome, b_info in blocos_meta.items():
    b_info['ds_intencionalidade'] = bloco_intencionalidades.get(bloco_nome, '')

pn_catalogo = {
    'eixos': ['Habilidades para a Vida', 'Meio Ambiente', 'Paz e Desenvolvimento', 'Saúde e Bem-Estar'],
    'blocos': list(blocos_meta.values()),
    'acoes': pn_acoes
}

with open(os.path.join(OUT_DIR, 'pn_catalogo.json'), 'w', encoding='utf-8') as f:
    json.dump(pn_catalogo, f, ensure_ascii=False, indent=2)

print(f"✓ Catálogo Novo gerado: {len(blocos_meta)} blocos e {len(pn_acoes)} ações educativas.")

# 3. Extraindo Regras de Equivalência das 4 abas de eixos
print("3. Extraindo regras de equivalência a partir das fórmulas Excel...")
axis_sheets = [
    ('Habilidades para a Vida', 'Habilidades para a Vida'),
    ('Meio Ambiente', 'Meio Ambiente'),
    ('Paz e Desenvolvimento', 'Paz e Desenvolvimento'),
    ('Saúde e Bem Estar', 'Saúde e Bem-Estar')
]

# Mapa de linha da aba Pistas/Rumo para código do item (ex: 'Pistas e Trilha'!A8 -> Pista 1)
row_to_pista = {item['excel_row']: item['cd_ueb'] for item in pistas_items}
row_to_rumo = {item['excel_row']: item['cd_ueb'] for item in rumo_items}

# Mapa de linha da aba Especialidades
esp_sheet = equiv_sheets.get('Especialidades ou Insígnias', {})
row_to_esp = {}
for r_idx, row in esp_sheet.items():
    esp_nome = row.get('A', {}).get('val', '').strip()
    if esp_nome and r_idx >= 7:
        row_to_esp[r_idx] = esp_nome

def strip_accents(text):
    if not text:
        return ''
    return ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn').lower().strip()

regras_equivalencia = []

for sheet_name, eixo_canonico in axis_sheets:
    sheet = equiv_sheets.get(sheet_name, {})
    current_bloco = ''
    current_tipo_acao = 'Fixa'
    
    for r_idx in sorted(sheet.keys()):
        row = sheet[r_idx]
        c_val = row.get('C', {}).get('val', '').strip()
        f_formula = row.get('F', {}).get('formula', '')
        g_formula = row.get('G', {}).get('formula', '')
        h_formula = row.get('H', {}).get('formula', '')
        i_formula = row.get('I', {}).get('formula', '')
        j_formula = row.get('J', {}).get('formula', '')
        
        f_val = row.get('F', {}).get('val', '').strip()
        h_val = row.get('H', {}).get('val', '').strip()
        
        # Detecta Bloco com normalização de acentos
        c_norm = strip_accents(c_val)
        for b_name in blocos_meta.keys():
            if strip_accents(b_name) in c_norm:
                current_bloco = b_name
                break
                
        if 'acoes educativas fixas' in c_norm:
            current_tipo_acao = 'Fixa'
            continue
        elif 'acoes educativas variaveis' in c_norm:
            current_tipo_acao = 'Variável'
            continue
            
        # Verifica se linha contém ação ou especialidade complementar
        all_formulas = f"{f_formula} {g_formula} {h_formula} {i_formula} {j_formula}"
        
        refs_pistas = []
        refs_rumo = []
        refs_especialidades = []
        
        for match in re.finditer(r"'Pistas e Trilha'!\$?A\$?([0-9]+)", all_formulas, re.IGNORECASE):
            target_row = int(match.group(1))
            ueb = row_to_pista.get(target_row)
            if ueb:
                refs_pistas.append(ueb)
                
        for match in re.finditer(r"'Rumo e Travessia'!\$?A\$?([0-9]+)", all_formulas, re.IGNORECASE):
            target_row = int(match.group(1))
            ueb = row_to_rumo.get(target_row)
            if ueb:
                refs_rumo.append(ueb)
                
        for match in re.finditer(r"'Especialidades ou Insígnias'!\$?[A-Z]+\$?([0-9]+)", all_formulas, re.IGNORECASE):
            target_row = int(match.group(1))
            esp = row_to_esp.get(target_row)
            if esp:
                refs_especialidades.append(esp)
                
        label_text = f"{f_val} {h_val}"
        
        if not refs_pistas and not refs_rumo and not refs_especialidades and not label_text.strip():
            continue
            
        min_count = 1
        j_form_str = j_formula or ''
        if '>=2' in j_form_str:
            min_count = 2
        elif '>=3' in j_form_str:
            min_count = 3
        elif '>=4' in j_form_str:
            min_count = 4
            
        tp_regra = 'OR' if (len(refs_pistas) + len(refs_rumo) + len(refs_especialidades)) > 1 and min_count == 1 else ('MIN_COUNT' if min_count > 1 else 'DIRETA')
        
        regras_equivalencia.append({
            'eixo': eixo_canonico,
            'bloco': current_bloco,
            'tipo_acao': current_tipo_acao,
            'excel_row': r_idx,
            'ds_acao_c': c_val,
            'label_f_h': label_text.strip(),
            'formula_j': j_formula,
            'tp_regra': tp_regra,
            'min_count': min_count,
            'refs_pistas_ueb': sorted(list(set(refs_pistas))),
            'refs_rumo_ueb': sorted(list(set(refs_rumo))),
            'refs_especialidades': sorted(list(set(refs_especialidades)))
        })

equiv_data = {
    'total_regras': len(regras_equivalencia),
    'regras': regras_equivalencia
}

with open(os.path.join(OUT_DIR, 'equivalencias.json'), 'w', encoding='utf-8') as f:
    json.dump(equiv_data, f, ensure_ascii=False, indent=2)

print(f"✓ Regras de Equivalência geradas: {len(regras_equivalencia)} regras extraídas com sucesso!")
