"""Generates src/styles/portal-theme.css from src/App.css:
   - dark-native rules (dark backgrounds / light text) get LIGHT overrides for day mode
   - light-native rules (white backgrounds / dark text / light borders) get DARK overrides for night mode
   The public homepage (home.css) has its own night mode and is untouched."""
import re, sys
css = '\n'.join(open(f, encoding='utf-8').read() for f in ('src/App.css', 'src/styles/departments.css', 'src/styles/staff.css'))
# strip comments
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

def lum(hexv):
    h = hexv.lstrip('#')
    if len(h) == 3: h = ''.join(c*2 for c in h)
    if len(h) != 6: return None
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    return 0.2126*r + 0.7152*g + 0.0722*b

HEX = re.compile(r'#[0-9a-fA-F]{3,6}\b')
# iterate rules at top level and within @media
def rules(text, media=None):
    i = 0
    while i < len(text):
        m = re.search(r'([^{}]+)\{', text[i:])
        if not m: break
        sel = m.group(1).strip()
        start = i + m.end()
        if sel.startswith('@media') or sel.startswith('@supports'):
            depth = 1; j = start
            while depth and j < len(text):
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            yield from rules(text[start:j-1], sel)
            i = j
        elif sel.startswith('@'):
            j = text.find('}', start); i = j+1
        else:
            j = text.find('}', start)
            yield media, sel, text[start:j]
            i = j+1

light_over = {}  # media -> list of (sel, decls)  for dark-native → light
dark_over = {}
SKIP = ('.gov-', '.smart-search', '.checklist', '.ai-', '.payment', '.push-card', ':root', 'html', 'body', '.leaflet', '.map-', '.status', '.ops-sidebar::before', '.notification-dot', '.skeleton')
for media, sel, body in rules(css):
    if any(s in sel for s in SKIP): continue
    if sel.startswith('.') is False and not sel.startswith(('a', 'button', 'input', 'select', 'textarea', 'table', 'th', 'td', 'h', 'p', 'small')):
        pass
    decls = [d.strip() for d in body.split(';') if ':' in d]
    light, dark = [], []
    for d in decls:
        prop, _, val = d.partition(':'); prop = prop.strip(); val = val.strip()
        if '!important' in val or 'var(' in val or 'url(' in val: continue
        hexes = HEX.findall(val)
        if not hexes and val not in ('white', '#fff'): 
            if prop in ('background','background-color') and val in ('white',): hexes=['#ffffff']
            else: continue
        if val == 'white': hexes = ['#ffffff']
        lums = [lum(h) for h in hexes if lum(h) is not None]
        if not lums: continue
        avg = sum(lums)/len(lums)
        if prop in ('background', 'background-color'):
            if 'gradient' in val and len(hexes) >= 2 and avg < 90:
                light.append(f'{prop}: var(--p-surface)')
            elif 'gradient' in val: continue
            elif avg < 90: light.append(f'{prop}: var(--p-surface)')
            elif avg > 225: dark.append(f'{prop}: var(--p-surface)')
            elif avg > 200: dark.append(f'{prop}: var(--p-surface-2)')
        elif prop == 'color':
            if avg > 170: light.append('color: var(--p-text)')
            elif avg < 70: dark.append('color: var(--p-text)')
            elif avg < 130: dark.append('color: var(--p-muted)')
        elif prop in ('border', 'border-color', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-inline-start', 'border-inline-end'):
            if avg < 90: light.append(f'{prop.replace("border","border-color") if prop=="border" else prop + ("-color" if prop != "border-color" else "")}: var(--p-line)')
            elif avg > 200: dark.append(f'{prop.replace("border","border-color") if prop=="border" else prop + ("-color" if prop != "border-color" else "")}: var(--p-line)')
        elif prop == 'box-shadow':
            if avg < 90: light.append('box-shadow: var(--p-shadow)')
            else: dark.append('box-shadow: var(--p-shadow)')
    DARK_SHELL = ('.ops-', '.dark-panel', '.governor', '.ranking', '.executive', '.health', '.super-admin', '.admin-', '.system-',
                  '.staff-table', '.service-admin', '.registry-', '.real-gis', '.alert-item', '.priority-number', '.pie-', '.period-',
                  '.secret-box', '.score-ring', '.staff-create', '.audit', '.operations')
    ACCENT = ('.button', '.primary', 'badge', '.status', '.chip', '.pill', '.tag', 'active', '.brand', '.role-chip', '.section-kicker', '.hero')
    is_dark_shell = any(k in sel for k in DARK_SHELL)
    has_dark_bg = any(d.startswith('background') for d in light)
    is_accent = any(a in sel for a in ACCENT)
    if light and (has_dark_bg or is_dark_shell) and not is_accent:
        light_over.setdefault(media, []).append((sel, light))
    if dark and not is_dark_shell and not is_accent:
        dark_over.setdefault(media, []).append((sel, dark))

out = ["""/* =============================================================================================
   GENERATED by scripts/dev/gen-portal-theme.py — do not edit by hand.
   Portal day/night theme derived from App.css: ops/admin surfaces get a light day mode,
   citizen/employee surfaces get a dark night mode. Tokens live in src/styles/portal-theme-tokens.css.
   ============================================================================================= */"""]
def emit(prefix, table):
    for media, items in table.items():
        block = []
        for sel, decls in items:
            sels = ', '.join(f'{prefix} {s.strip()}' for s in sel.split(','))
            joined = ';\n  '.join(decls)
            block.append(sels + ' {\n  ' + joined + ';\n}')
        text = '\n'.join(block)
        if media:
            text = media + ' {\n' + text + '\n}'
        out.append(text)
emit(":root:not([data-gov-theme='dark'])", light_over)
emit(":root[data-gov-theme='dark']", dark_over)
open('src/styles/portal-theme.css', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('light overrides', sum(len(v) for v in light_over.values()), 'dark overrides', sum(len(v) for v in dark_over.values()))
