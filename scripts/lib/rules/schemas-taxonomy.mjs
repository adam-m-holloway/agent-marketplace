// catalogue.json/status.json match their schemas; category, keywords and languages are on-taxonomy;
// languages other than ["any"] require `compatibility` in every SKILL.md.
import { STAGES } from '../plugins.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { f, loadValidator, loadOwnJson, skipped } from './_util.mjs';

const ID = 'schemas-taxonomy';

export default {
  id: ID,
  group: 'plugins',
  async run({ repo }) {
    const out = [];
    const validate = await loadValidator();
    if (!validate) out.push(skipped(ID, 'scripts/lib/schema.mjs'));
    const tax = repo.taxonomy;
    for (const p of repo.plugins) {
      const catFile = `${p.path}/catalogue.json`;
      const stFile = `${p.path}/status.json`;
      const manFile = `${p.path}/.claude-plugin/plugin.json`;
      if (validate) {
        if (p.catalogue) for (const e of validate(loadOwnJson('schema/catalogue.schema.json'), p.catalogue)) out.push(f(ID, 'ERROR', catFile, `schema: ${e.path || '/'} ${e.message}`));
        if (p.status) for (const e of validate(loadOwnJson('schema/status.schema.json'), p.status)) out.push(f(ID, 'ERROR', stFile, `schema: ${e.path || '/'} ${e.message}`));
      }
      if (p.status && !STAGES.includes(p.status.stage)) out.push(f(ID, 'ERROR', stFile, `stage "${p.status.stage}" is not one of ${STAGES.join(', ')}`));
      if (p.catalogue) {
        const { category, languages } = p.catalogue;
        if (!tax.categories.includes(category)) out.push(f(ID, 'ERROR', catFile, `category "${category}" is not in taxonomy.json`));
        if (!Array.isArray(languages) || !languages.length) out.push(f(ID, 'ERROR', catFile, 'languages must be a non-empty array'));
        else {
          for (const l of languages) if (!tax.languages.includes(l)) out.push(f(ID, 'ERROR', catFile, `language "${l}" is not in taxonomy.json`));
          const any = languages.length === 1 && languages[0] === 'any';
          if (!any) {
            if (languages.includes('any')) out.push(f(ID, 'ERROR', catFile, '"any" cannot be combined with other languages'));
            for (const s of p.skills) {
              if (s.skillMd && !parseFrontmatter(s.skillMd).data.compatibility) {
                out.push(f(ID, 'ERROR', `${s.path}/SKILL.md`, `catalogue languages are ${JSON.stringify(languages)} so SKILL.md needs a \`compatibility\` field`, 1));
              }
            }
          }
        }
      }
      for (const k of Array.isArray(p.manifest?.keywords) ? p.manifest.keywords : []) {
        if (!tax.tags.includes(k)) out.push(f(ID, 'ERROR', manFile, `keyword "${k}" is not in taxonomy.json tags`));
      }
    }
    return out;
  },
};
