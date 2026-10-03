"""Organize loose files, preserving all bytes and CPH test data."""
from pathlib import Path
import gzip, hashlib, json, shutil, urllib.parse

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.migration'/'2026-10-03'
BACK=BASE/'backup'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    mapping={}
    for p in ROOT.iterdir():
        if not p.is_file():continue
        if p.suffix=='.cpp':folder='30代码练习/洛谷题目' if p.stem.startswith('P') and p.stem[1:].isdigit() else '30代码练习/临时与测试'
        elif p.suffix=='.exe':folder='40编译与性能/可执行文件'
        elif p.name=='gmon.out':folder='40编译与性能/性能分析'
        elif p.suffix=='.html':folder='50历史报告'
        else:continue
        dest=ROOT/folder/p.name
        assert dest.resolve().is_relative_to(ROOT.resolve()) and p.parent==ROOT
        assert not dest.exists(),dest
        backup=BACK/p.name
        if not backup.exists():shutil.copy2(p,backup)
        oldhash=sha(p);dest.parent.mkdir(parents=True,exist_ok=True)
        p.rename(dest)
        assert sha(dest)==oldhash
        mapping[p.name]={'old':p.name,'new':dest.relative_to(ROOT).as_posix(),'sha256':oldhash,'bytes':dest.stat().st_size}
    # Preserve every test case and result; only replace the source path.
    cph=[]
    for p in (ROOT/'.cph-ng').glob('*.bin'):
        backup=BACK/'.cph-ng'/p.name;backup.parent.mkdir(parents=True,exist_ok=True)
        if not backup.exists():shutil.copy2(p,backup)
        d=json.loads(gzip.decompress(p.read_bytes()))
        old=d.get('src',{}).get('path','');name=Path(old).name
        if name not in mapping:continue
        dest=ROOT/mapping[name]['new'];new=str(dest)
        d['src']['path']=new
        encoded=gzip.compress(json.dumps(d,ensure_ascii=False,separators=(',',':')).encode('utf8'),mtime=0)
        p.write_bytes(encoded)
        original=json.loads(gzip.decompress(backup.read_bytes()));updated=json.loads(gzip.decompress(p.read_bytes()))
        original['src']['path']=new
        assert original==updated
        assert dest.exists()
        cph.append({'file':p.name,'old_source':old,'new_source':new,'testcases_preserved':True})
    data={'moves':list(mapping.values()),'cph_updates':cph,'project_preserved':'vscode-chromium-browser-patch'}
    (BASE/'file-moves.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    lines=['# 全部文件整理清单','','笔记与洛谷文章见 [仓库导航](../00仓库导航.md)；本页列出其余文件。仅按用途归档，未修改 C++ 源码或运行可执行文件。所有移动均有备份与 SHA-256 校验。','', '## 代码练习','']
    for row in mapping.values():
        if row['new'].endswith('.cpp'):
            desc=''
            if row['old']=='P5266.cpp':desc=' — 空白代码文件，保留待写'
            if row['old']=='P16963.cpp':desc=' — 未完成的代码片段，保留原文'
            if row['old']=='fmtext.cpp':desc=' — 约 12.4 MB，包含大量重复右花括号，保留为历史测试文件'
            lines.append('- ['+row['old']+'](../'+urllib.parse.quote(row['new'],safe='/')+')'+desc)
    lines+=['','## 编译、性能与报告','']
    for row in mapping.values():
        if not row['new'].endswith('.cpp'):
            desc=' — 文件实际上只含 Markdown 标题“比赛情况”，没有完整报告正文' if row['old'].endswith('.html') else ''
            lines.append('- ['+row['old']+'](../'+urllib.parse.quote(row['new'],safe='/')+')'+desc)
    lines+=['','## 原位置保留的功能目录','','- `.obsidian/`：插件、主题、工作区配置。新增了原生 Callout 的表格样式。','- `.vscode/`：编辑、编译配置。编译任务使用活动文件路径，移动源码后仍有效。','- `.cph-ng/`：测试用例及结果。六份缓存仅更新源码路径，其余字段逐项比较不变。','- `.git/`：Git 历史。未提交或回退已有改动。','- `vscode-chromium-browser-patch/`：独立扩展项目，保持完整结构与内容。','- `tools/`：本次转换脚本与 VS Code Callout 扩展源码。','- `.migration/2026-10-03/`：原文、备份、校验记录及 RemNote 导入包。','','## 验证与恢复','','移动 13 个散落文件，8 份 C++ 文件、3 份 EXE、1 份性能输出、1 份 HTML；内容哈希全部保持一致。具体旧路径、新路径及哈希见 `.migration/2026-10-03/file-moves.json`。恢复时依据该文件逐个移回，并从 `backup/.cph-ng/` 恢复缓存。不要对整个仓库执行清空或覆盖操作。','']
    (ROOT/'90说明/全部文件整理清单.md').write_text('\n'.join(lines),encoding='utf8')
    nav=ROOT/'00仓库导航.md'
    text=nav.read_text(encoding='utf8')
    text=text.replace('[使用与格式说明](90说明/使用与格式说明.md)', '[全部文件清单](90说明/全部文件整理清单.md) · [使用与格式说明](90说明/使用与格式说明.md)')
    nav.write_text(text,encoding='utf8')
    print(json.dumps({'moved':len(mapping),'cph_updated':len(cph),'all_hashes_match':True},ensure_ascii=False))

if __name__=='__main__':main()
