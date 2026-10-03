'use strict';

function extendMarkdownIt(md) {
  if (md.__vaultCallouts) return md;
  md.__vaultCallouts = true;
  md.core.ruler.after('inline', 'vault_callouts', state => {
    const tokens = state.tokens;
    const removed = new Set();
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open' || tokens[i + 1]?.type !== 'paragraph_open' || tokens[i + 2]?.type !== 'inline' || tokens[i + 3]?.type !== 'paragraph_close') continue;
      const match = tokens[i + 2].content.match(/^\[!([a-z-]+)\]([+-]?)\s*(.*)$/i);
      if (!match) continue;
      let end = i + 1, depth = 1;
      for (; end < tokens.length; end++) {
        if (tokens[end].type === 'blockquote_open') depth++;
        if (tokens[end].type === 'blockquote_close' && --depth === 0) break;
      }
      if (end >= tokens.length) continue;
      const titleTokens = [];
      md.inline.parse(match[3] || match[1], md, state.env, titleTokens);
      tokens[i].type = 'vault_callout_open';
      tokens[i].meta = { kind: match[1].toLowerCase(), open: match[2] !== '-', titleTokens };
      tokens[end].type = 'vault_callout_close';
      removed.add(i + 1); removed.add(i + 2); removed.add(i + 3);
    }
    state.tokens = tokens.filter((_, i) => !removed.has(i));
  });
  md.renderer.rules.vault_callout_open = (tokens, idx, options, env, self) => {
    const { kind, open, titleTokens } = tokens[idx].meta;
    const line = tokens[idx].map?.[0];
    const source = Number.isInteger(line) ? ` data-line="${line}"` : '';
    return `<details class="vault-callout vault-${md.utils.escapeHtml(kind)} code-line"${source}${open ? ' open' : ''}><summary>${self.renderInline(titleTokens, options, env)}</summary><div class="vault-callout-body">\n`;
  };
  md.renderer.rules.vault_callout_close = () => '</div></details>\n';
  return md;
}

exports.activate = () => ({ extendMarkdownIt });
exports.extendMarkdownIt = extendMarkdownIt;
