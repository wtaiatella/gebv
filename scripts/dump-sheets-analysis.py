import zipfile
import xml.etree.ElementTree as ET
import os

file_path = 'docs/escoteiro/2026 02 26 - Equiparação progressão ramo escoteiro.xlsx'

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

    for s in sheets:
        name = s.attrib['name']
        if name not in ['Habilidades para a Vida', 'Meio Ambiente', 'Paz e Desenvolvimento', 'Saúde e Bem Estar']:
            continue
        r_id = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = rel_map.get(r_id, '')
        s_path = 'xl/' + target if not target.startswith('xl/') else target
        
        root = ET.fromstring(z.read(s_path))
        ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
        
        print(f'========================================================================')
        print(f'=== ABA: {name} ===')
        print(f'========================================================================')
        for row in root.findall(f'{ns}sheetData/{ns}row'):
            r_idx = int(row.attrib.get('r'))
            cells = {}
            for c in row.findall(f'{ns}c'):
                ref = c.attrib.get('r')
                col_letter = ''.join([ch for ch in ref if ch.isalpha()])
                t = c.attrib.get('t')
                v = c.find(f'{ns}v')
                val = v.text if v is not None else ''
                if t == 's' and val.isdigit():
                    val = sst[int(val)]
                f = c.find(f'{ns}f')
                f_val = f.text if f is not None else ''
                cells[col_letter] = (val, f_val)
            
            b = str(cells.get('B', ('', ''))[0] or '').strip()
            c = str(cells.get('C', ('', ''))[0] or '').strip()
            d = str(cells.get('D', ('', ''))[0] or '').strip()
            f = str(cells.get('F', ('', ''))[0] or '').strip()
            h = str(cells.get('H', ('', ''))[0] or '').strip()
            j_f = cells.get('J', ('', ''))[1]
            j_v = cells.get('J', ('', ''))[0]
            j = (j_f if j_f else j_v) or ''
            
            if any([b, c, d, f, h, j]):
                print(f'R{r_idx:03d} | B:[{b}] | C:[{c}] | F:[{f}] | H:[{h}] | J:[{j}]')
