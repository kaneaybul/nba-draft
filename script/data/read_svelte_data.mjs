// Decode serialized public page literals without executing remote JavaScript.
import ts from '../../frontend/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
export function readPageData(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  let result;
  for (const [,source] of scripts) {
    if (!source.includes('kit.start')) continue;
    const tree = ts.createSourceFile('page.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(n) {
      if (ts.isCallExpression(n) && n.expression.getText(tree).endsWith('.start') && n.arguments.length >= 3) {
        const obj = n.arguments[2];
        if (ts.isObjectLiteralExpression(obj)) {
          const prop = obj.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(tree) === 'data');
          if (prop) result = literal(prop.initializer);
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(tree);
  }
  if (!result) throw Error('Public page data not found; source format changed');
  return result.filter(x => x?.type === 'data').map(x => x.data);
}
function literal(n) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (n.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(n)) return null;
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(n) && [ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(n.operator)) return (n.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * literal(n.operand);
  if (ts.isArrayLiteralExpression(n)) return n.elements.map(literal);
  if (ts.isObjectLiteralExpression(n)) return Object.fromEntries(n.properties.map(p => {
    if (!ts.isPropertyAssignment(p)) throw Error('Nonliteral property');
    return [p.name.text, literal(p.initializer)];
  }));
  throw Error('Nonliteral source data rejected: '+ts.SyntaxKind[n.kind]);
}
if (process.argv[1]?.endsWith('read_svelte_data.mjs')) process.stdout.write(JSON.stringify(readPageData(fs.readFileSync(process.argv[2],'utf8'))));
