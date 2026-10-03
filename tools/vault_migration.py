"""Preserve Luogu source, convert presentation only, and prepare RemNote import."""
from pathlib import Path
import collections, csv, hashlib, html, json, re, shutil, urllib.request, urllib.parse, zipfile
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.migration' / '2026-10-03'
BACKUP = BASE / 'backup'
REPORT = {'date': '2026-10-03', 'notes': [], 'assets': [], 'warnings': []}

def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')

def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def frontmatter(meta):
    return '---\n' + '\n'.join(k + ': ' + json.dumps(v, ensure_ascii=False) for k, v in meta.items()) + '\n---\n\n'

def split_fence(line, fence):
    line = re.sub(r'^(?:> ?)+', '', line)
    m = re.match(r'^\s{0,3}(`{3,}|~{3,})(.*)$', line)
    if fence:
        if m and m[1][0] == fence[0] and len(m[1]) >= len(fence) and not m[2].strip():
            return None
        return fence
    return m[1] if m else None

def repaired_source(text, key):
    # A raw C++ file posted without Markdown fences is unambiguous.
    if text.lstrip().startswith('#include') and not re.search(r'^\s*```', text, re.M):
        REPORT['warnings'].append({'file': key, 'repair': '给全文 C++ 添加代码围栏，代码内容不变'})
        return '```cpp\n' + text.rstrip('\n') + '\n```\n'
    return text

def convert(text, key, remnote=False):
    lines = repaired_source(text, key).splitlines()
    out, stack, fence = [], [], None
    heading = 1
    repairs = []
    def emit(line, depth=None):
        d = len(stack) if depth is None else depth
        out.append(('> ' * d + line) if line else ('> ' * d).rstrip()) if not remnote else out.append(line)
    def blank(depth=None):
        emit('', depth)
    for lineno, line in enumerate(lines, 1):
        old_fence = fence
        fence = split_fence(line, fence)
        if old_fence or fence:
            if not old_fence:
                # Keep highlighting portable; retain any metadata in a comment.
                fm = re.match(r'^((?:> ?)*\s*)(`{3,}|~{3,})(.*)$', line)
                info = fm[3].strip()
                if info and ('line-numbers' in info or 'lines=' in info):
                    emit('<!-- luogu-code-options: ' + html.escape(info) + ' -->')
                    line = fm[1] + fm[2] + info.split()[0]
                elif not info:
                    line += 'cpp'
            emit(line)
            continue
        # Preserve body text; only delimiters and Luogu directives change.
        op = re.match(r'^\s*(:{3,})(info|success|warning|error|align|epigraph)?(?:\[(.*)\])?(?:\{([^}]*)\})?\s*$', line)
        if op:
            n, kind, title, params = len(op[1]), op[2], op[3], op[4]
            is_open = kind is not None or title is not None
            if is_open:
                while stack and n >= stack[-1]['n']:
                    repairs.append(f'第 {lineno} 行前补闭合：{stack[-1]["title"]}')
                    stack.pop()
                    blank()
                blank()
                kind = kind or 'info'
                title = title or {'info':'提示','success':'成功','warning':'警告','error':'错误','align':'排版','epigraph':'引言'}[kind]
                if kind == 'align':
                    # These containers are not present in this archive; fail rather than silently degrade.
                    raise ValueError(f'Unsupported alignment: {key}:{lineno}')
                if remnote:
                    symbol = {'info':'ℹ️','success':'✅','warning':'⚠️','error':'❌','epigraph':'❝'}[kind]
                    emit('#' * min(6, heading + len(stack) + 1) + ' ' + symbol + ' ' + title, 0)
                    blank(0)
                else:
                    callout = 'danger' if kind == 'error' else ('quote' if kind == 'epigraph' else kind)
                    emit(f'[!{callout}]{"+" if params == "open" else "-"} {title}', len(stack)+1)
                    blank(len(stack)+1)
                stack.append({'n':n,'title':title,'kind':kind})
            else:
                matching = [j for j,s in enumerate(stack) if s['n']==n]
                if matching:
                    j = matching[-1]
                    for missed in stack[j+1:]: repairs.append(f'第 {lineno} 行前补闭合：{missed["title"]}')
                    del stack[j:]
                else:
                    repairs.append(f'第 {lineno} 行孤立闭合标记移除（原文留在备份）')
                blank()
            continue
        if re.match(r'^\s*::cute-table\{tuack\}\s*$', line):
            emit('<!-- luogu-table: tuack -->')
            continue
        # Native dollar delimiters work in Obsidian and VS Code's KaTeX.
        before_math=line
        line = re.sub(r'\\{1,2}\((.+?)\\{1,2}\)', lambda m:'$'+m[1]+'$', line)
        line = re.sub(r'\\{1,2}\[(.+?)\\{1,2}\]', lambda m:'$$'+m[1]+'$$', line)
        def normalize_math(m):
            delim=m[1];formula=m[2].strip()
            # Double-escaped commands came from pasted Markdown; retain real row separators.
            formula=re.sub(r'\\\\(?=(?:times|leq|geq|log|frac|dots|cdots|sum|prod|sqrt|min|max|left|right|operatorname|text|color|div|mod|le|ge|neq|lfloor|rfloor|lceil|rceil)\b)',r'\\',formula)
            formula=formula.replace('\\lep ', '\\leq ')
            # The intended operation for this original typo is unknown: preserve the literal backslash.
            formula=re.sub(r'\\m(?![A-Za-z])',r'\\backslash m',formula)
            return delim+formula+delim
        line=re.sub(r'(\${1,2})([^$\n]+?)\1',normalize_math,line)
        if line!=before_math and not remnote:
            REPORT['warnings'].append({'file':key,'line':lineno,'repair':'规范公式分隔符、边界空格或命令转义；原始公式保留在备份','before':before_math,'after':line})
        hm = re.match(r'^(#{1,6})\s', line)
        if hm and not stack: heading = len(hm[1])
        # Formula content stays byte-for-byte intact between normalized display delimiters.
        dm = re.fullmatch(r'\s*\$\$(.+)\$\$\s*', line)
        if dm:
            blank(); emit('$$'); emit(dm[1]); emit('$$'); blank()
        else:
            emit(line)
    if fence:
        emit(fence)
        repairs.append('文件末尾补代码围栏闭合')
    for s in stack: repairs.append('文件末尾补折叠闭合：'+s['title'])
    if repairs and not remnote: REPORT['warnings'].append({'file':key,'repairs':repairs})
    return '\n'.join(out).strip()+'\n'

TOPICS = {
    '图论': ['拓扑','最短路','最小生成树','Dijkstra','Floyd','图论','BFS','广度优先','结点的度'],
    '数据结构': ['并查集','树状数组','单调栈','单调队列','ST表','ST 表','线段树','分块'],
    '数学': ['质因','gcd','lcm','公约数','公倍数','唯一分解','数学','数位'],
    '搜索': ['DFS','dfs','回溯','深度优先','全排列','枚举'],
    '贪心与二分': ['贪心','二分','双指针'],
    '动态规划': ['动态规划','DP','dp作业','斐波那契','最大子段和'],
    '模拟': ['模拟','字符串','大爆炸版石头剪刀布'],
}

def topics(text, title):
    # Use prose/headings and title, not C++ variable names, to infer tags.
    prose, fence = [], None
    for l in text.splitlines():
        was=fence; fence=split_fence(l,fence)
        if not was and not fence: prose.append(l)
    s=title+'\n'+'\n'.join(prose)
    return [k for k,words in TOPICS.items() if any(w in s for w in words)] or ['综合']

def category(a, text):
    year=a['published'][:4]
    if a['category']=='题解': return '02题解'
    if re.search(r'^#\s*(?:\*\*)?(?:比赛情况|考试情况|比赛总结)',text,re.M) or re.search('比赛|测试|模拟赛',a['title']):
        return '03比赛复盘/'+year
    first=re.search(r'^# (.+)',text,re.M)
    concept = first and re.match(r'^(?:拓扑排序|并查集|单调栈|ST表|最短路|最小生成树|分解质因数|贪心)$',first[1])
    if concept:
        primary={'拓扑排序':'图论','最短路':'图论','最小生成树':'图论','并查集':'数据结构','单调栈':'数据结构','ST表':'数据结构','分解质因数':'数学','贪心':'贪心与二分'}[first[1]]
        return '01算法笔记/'+primary
    return '04课堂与练习/'+year

IMAGE_RE = re.compile(r'!\[([^\]]*)\]\((https?://[^\s)]+)([^)]*)\)')

def download_asset(url):
    h=hashlib.sha256(url.encode()).hexdigest()[:16]
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req,timeout=25) as r:
            data=r.read(); ct=r.headers.get('Content-Type','').split(';')[0]
        ext={'image/svg+xml':'.svg','image/png':'.png','image/apng':'.apng','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp'}.get(ct)
        if not ext and data.startswith(b'\x89PNG\r\n\x1a\n'): ext='.apng' if b'acTL' in data else '.png'
        if not ext or not data: raise ValueError('Not an image: '+ct)
        target=ROOT/'80附件'/('image-'+h+ext)
        target.parent.mkdir(exist_ok=True);target.write_bytes(data)
        return {'url':url,'path':target.relative_to(ROOT).as_posix(),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'status':'saved'}
    except Exception as e:
        return {'url':url,'status':'failed','error':str(e)}

def code_bodies(text, quoted=False):
    result=[]; body=[]; fence=None
    for l in text.splitlines():
        l='' if re.fullmatch(r'(?:> )*>',l) else re.sub(r'^(?:> )+', '', l)
        was=fence; fence=split_fence(l,fence)
        if was and fence:body.append(l)
        elif was and not fence:result.append('\n'.join(body));body=[]
    if fence:result.append('\n'.join(body))
    return result

def main():
    captured=json.loads((BASE/'captured.json').read_text(encoding='utf8'))
    listing=json.loads((BASE/'list-metadata.json').read_text(encoding='utf8'))
    assert len(captured)==len(listing)==72
    assert {x['url'] for x in captured}=={x['url'] for x in listing}
    recs=[]
    for a in listing:
        if a['title'].startswith('"') and a['title'].endswith('"'):
            a['title']=json.loads(a['title'])
        a['id']=a['url'].split('/')[-1]
        text=(BASE/'raw-luogu'/(a['id']+'.md')).read_text(encoding='utf8')
        c=next(x for x in captured if x['url']==a['url'])
        assert len(text.encode('utf-16-le'))//2==c['length'],a['id']
        folder='20洛谷文章/'+category(a,text)
        filename=re.sub(r'[<>:"/\\|?*]', ' ', a['title']).strip().rstrip('.')+' ['+a['id']+'].md'
        recs.append({'title':a['title'],'source':'luogu','source_url':a['url'],'luogu_id':a['id'],'published':a['published'],'original_category':a['category'],'original_status':a['status'],'tags':['来源/洛谷']+['主题/'+k for k in topics(text,a['title'])],'path':folder+'/'+filename,'text':text})
    local_folders={'拓扑排序':'图论','最短路总结':'图论','最小生成树':'图论','贪心':'算法策略','质因数分解':'数学','最大公约数与最小公倍数':'数学','集训比赛总结':'比赛复盘','6.13比赛总结':'比赛复盘'}
    for f in BACKUP.glob('*.md'):
        if f.name=='AGENTS.md':continue
        text=f.read_text(encoding='utf-8-sig')
        folder='10本地笔记/'+local_folders[f.stem] if f.stem in local_folders else ('90模板' if f.stem=='总结模板' else '90说明')
        recs.append({'title':f.stem,'source':'local','original_path':f.name,'aliases':[f.stem],'tags':['来源/本地']+['主题/'+k for k in topics(text,f.stem)],'path':folder+'/'+f.name,'text':text})
    assert len(recs)==82
    groups=collections.defaultdict(list)
    for r in recs:groups[digest(r['text'].replace('\r\n','\n').strip())].append(r)
    for group in groups.values():
        if len(group)>1:
            for r in group:r['identical_sources']=[x['path'] for x in group if x is not r]
    urls=sorted({m[2] for r in recs for m in IMAGE_RE.finditer(r['text'])})
    with ThreadPoolExecutor(max_workers=6) as pool:REPORT['assets']=list(pool.map(download_asset,urls))
    assets={a['url']:a['path'] for a in REPORT['assets'] if a['status']=='saved'}
    remroot=BASE/'remnote-import'/'编程算法学习库'
    for r in recs:
        raw=r.pop('text');outpath=ROOT/r['path']
        ob=convert(raw,r['path']);rem=convert(raw,r['path'],True)
        def relimages(text):
            return IMAGE_RE.sub(lambda m:'!['+m[1]+']('+urllib.parse.quote(__import__('os').path.relpath(ROOT/assets[m[2]],outpath.parent).replace('\\','/'),safe='/')+m[3]+')' if m[2] in assets else m[0],text)
        ob=relimages(ob);rem=relimages(rem)
        meta={k:v for k,v in r.items() if k not in ('path','identical_sources')}
        if r.get('identical_sources'):meta['identical_sources']=r['identical_sources']
        ob=frontmatter(meta)+ob
        original_code=code_bodies(repaired_source(raw,r['path']))
        assert original_code==code_bodies(ob,True), 'Changed code: '+r['path']
        assert original_code==code_bodies(rem), 'Changed import code: '+r['path']
        # Ordinary relative Markdown links work in both clients.
        def wiki(m):
            target=m[1];label=m[2] or target
            found=next((x for x in recs if Path(x['path']).stem==target),None)
            return '['+label+']('+urllib.parse.quote(__import__('os').path.relpath(ROOT/found['path'],outpath.parent).replace('\\','/'),safe='/')+')' if found else m[0]
        ob=re.sub(r'(?<!!)\[\[([^]|]+)(?:\|([^]]+))?\]\]',wiki,ob)
        rem=re.sub(r'(?<!!)\[\[([^]|]+)(?:\|([^]]+))?\]\]',wiki,rem)
        write(outpath,ob)
        remmeta='# '+r['title']+'\n\n'
        if r['source']=='luogu':remmeta+='来源：['+r['luogu_id']+']('+r['source_url']+')  \n发布时间：'+r['published']+'  \n洛谷分类：'+r['original_category']+'；状态：'+r['original_status']+'\n\n'
        else:remmeta+='来源：本地仓库 '+r['original_path']+'\n\n'
        remmeta+='主题：'+ '、'.join(t.split('/')[-1] for t in r['tags'][1:])+'\n\n---\n\n'
        write(remroot/r['path'],remmeta+rem)
        REPORT['notes'].append({**r,'source_sha256':digest(raw),'output_sha256':digest(ob),'code_blocks':len(original_code),'source_characters':len(raw)})
    for a in REPORT['assets']:
        if a['status']=='saved':
            target=remroot/a['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/a['path'],target)
    # Only remove the backed-up root notes after their converted copies are verified.
    for r in recs:
        if r['source']=='local':
            old=ROOT/r['original_path']
            if old.exists():
                assert old.parent==ROOT and old.suffix=='.md' and old.name!='AGENTS.md'
                assert old.read_bytes()==(BACKUP/old.name).read_bytes(),'Source changed during migration'
                old.unlink()
    index=['# 编程算法学习库','', '共 72 篇洛谷文章、8 篇本地学习笔记，另保留模板与欢迎页。','', '[使用与格式说明](90说明/使用与格式说明.md) · [主题索引](00主题索引.md)','']
    for folder in sorted({str(Path(r['path']).parent).replace('\\','/') for r in recs}):
        index+=['## '+folder,'']
        for r in recs:
            if str(Path(r['path']).parent).replace('\\','/')==folder:
                index+=['- ['+r['title']+']('+urllib.parse.quote(r['path'],safe='/')+')'+(' · '+r.get('published','') if r.get('published') else '')]
        index.append('')
    write(ROOT/'00仓库导航.md','\n'.join(index));write(remroot/'00仓库导航.md','\n'.join(index))
    thematic=['# 主题索引','', '按正文、标题中的算法名称整理；一篇文章可属于多个主题，日期类文件保留原来的版本。','']
    for t in list(TOPICS)+['综合']:
        thematic+=['## '+t,'']
        thematic+=['- ['+r['title']+']('+urllib.parse.quote(r['path'],safe='/')+')' for r in recs if '主题/'+t in r['tags']]
        thematic.append('')
    thematic+=['## 原文完全相同的版本','', '全部保留，不合并。','']
    for g in groups.values():
        if len(g)>1:thematic+=['- '+' · '.join('['+r['title']+']('+urllib.parse.quote(r['path'],safe='/')+')' for r in g)]
    write(ROOT/'00主题索引.md','\n'.join(thematic));write(remroot/'00主题索引.md','\n'.join(thematic))
    guide='''# 使用与格式说明

本库在 2026-10-03 从本地笔记与洛谷“我的专栏”整理。洛谷 72 个文章 ID 全部保留，同名文章按 ID 区分。分类以文章内容为主；原站分类、状态、发布时间在属性中保留。

## 阅读

- Obsidian：打开此目录，原生 Callout 支持多层折叠，无需新增社区插件。
- VS Code：使用内置 Markdown 预览，配套 `zrh-local.vault-callouts` 扩展显示彩色折叠框。数学公式、表格和代码使用内置功能。
- RemNote：导入 `.migration/2026-10-03/remnote-编程算法学习库.zip`。ZIP 内目录成为文件夹，折叠框改为带提示符号的标题层级。不要再次导入同一包以免产生重复版本。

## 格式对应

| 洛谷 | Obsidian 与 VS Code | RemNote |
| --- | --- | --- |
| `:::info` | `> [!info]` | ℹ️ 提示标题 |
| `:::success` | `> [!success]` | ✅ 提示标题 |
| `:::warning` | `> [!warning]` | ⚠️ 提示标题 |
| `:::error` | `> [!danger]` | ❌ 提示标题 |
| `{open}` | `+` 默认展开；无参数用 `-` 默认折叠 | 标题内容展开为笔记 |
| `::cute-table{tuack}` | 标准 Markdown 表格，配套表格 CSS | 标准表格内容 |
| 数学公式、代码、图片 | 保留公式与代码；可下载图片归档至附件目录 | 保留公式与代码，图片随 ZIP 导入 |

VS Code 不启用配套扩展时，正文仍是可读的标准引用块，提示标记会显示为文字。Tuack 表格边框风格由 CSS 近似保留，跨应用字体和数学引擎可能有细微差别。RemNote 无法执行 Obsidian/VS Code 的 CSS，因此不保留折叠框颜色与默认折叠状态。

## 备份与验证

原始本地文件和配置在 `.migration/2026-10-03/backup/`；洛谷原始 Markdown 在 `.migration/2026-10-03/raw-luogu/`。备份包括本次开始前已有的未提交改动。代码逐块比较内容，所有正文只进行格式转换，不修订算法或叙述。格式修复及无法下载的图片见 `.migration/2026-10-03/report.json`。

练习代码、编译产物、性能输出和历史报告按用途归档，见 [全部文件清单](全部文件整理清单.md)。现有浏览器补丁项目保留完整结构。来源状态（包括被打回）仅是原站记录，不是对笔记内容的评价。

## 参考

- [洛谷 Markdown 格式手册](https://help.luogu.com.cn/rules/academic/handbook/markdown)
- [Obsidian Callout](https://obsidian.md/help/callouts)
- [VS Code Markdown 扩展接口](https://code.visualstudio.com/api/extension-guides/markdown-extension)
- [RemNote 导入说明](https://help.remnote.com/en/articles/6330674-notes-on-remnote-importers)
'''
    write(ROOT/'90说明'/'使用与格式说明.md',guide)
    write(remroot/'90说明'/'使用与格式说明.md',guide)
    REPORT['counts']={'luogu':72,'local_learning':8,'templates_and_welcome':2,'import_markdown_files':len(list(remroot.rglob('*.md'))),'images_saved':len(assets),'images_failed':len(urls)-len(assets)}
    REPORT['warnings']=list({json.dumps(x,ensure_ascii=False):x for x in REPORT['warnings']}.values())
    write(BASE/'report.json',json.dumps(REPORT,ensure_ascii=False,indent=2))
    with (BASE/'articles.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['title','source','path','source_url','published','original_category','original_status','source_sha256','output_sha256','code_blocks'],extrasaction='ignore');w.writeheader();w.writerows(REPORT['notes'])
    with zipfile.ZipFile(BASE/'remnote-编程算法学习库.zip','w',zipfile.ZIP_DEFLATED) as z:
        for p in remroot.rglob('*'):
            if p.is_file():z.write(p,p.relative_to(remroot.parent).as_posix())
    print(json.dumps(REPORT['counts'],ensure_ascii=False))
    print('Formatting warnings:',len(REPORT['warnings']))

if __name__=='__main__':main()
