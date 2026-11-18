/**
 * Contract gate: package manifest, bundle patch, and locale files must keep
 * the exact shape ClientModuleRegistry / bundle-platform / settings expect on
 * DSH 0.2.2-rc.3 (mirrors the dsh-subagent-plus 0.0.4 exemplar field by
 * field). Extended in later phases alongside src/ and client/ artifacts.
 *
 * @module dsh-mm-resilience/tests/contract.test
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const pkg = JSON.parse(read('package.json'))

test('package manifest: name/type/engines', () => {
  assert.equal(pkg.name, 'dsh-mm-resilience')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.ok(pkg.engines.node.startsWith('>=22'))
})

test('package manifest: exports map has the exact keys rc.3 discovers', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './client', './locale/*.json', './package.json'])
  assert.equal(pkg.exports['.'], './src/index.js')
  assert.ok(existsSync(path.join(root, 'src/index.js')), 'host half exists at exports["."]')
  // "./client" must be a string or {default: string} (clientExportOf).
  const client = pkg.exports['./client']
  const clientTarget = typeof client === 'string' ? client : client.default
  assert.equal(typeof clientTarget, 'string')
  assert.match(clientTarget, /^\.\/client\//)
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
})

test('package manifest: dsh.bundle.patch points at the patch file', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.match(read('cordis.patch.yml'), /- insert:/)
  assert.match(read('cordis.patch.yml'), /id:\s*mm-resilience/)
  assert.match(read('cordis.patch.yml'), /name:\s*dsh-mm-resilience/)
})

test('package manifest: dsh.client matches the proven exemplar exactly', () => {
  const client = pkg.dsh.client
  assert.equal(client.platform, 'web')
  assert.deepEqual(client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-api-remotes',
  ])
  assert.deepEqual(client.external, ['@deepseek-ai/dsh-client-ui-primitives'])
  // A row must never list itself (orderByModuleGraph rejects self-reference).
  for (const name of [...client.inject, ...client.external]) {
    assert.notEqual(name, pkg.name)
  }
})

test('package manifest: schemastery pinned like the exemplar, cordis peer', () => {
  assert.equal(pkg.dependencies['@deepseek-ai/schemastery'], '>=3.18.4 <4')
  assert.ok(pkg.peerDependencies['@deepseek-ai/cordis'])
})

test('locale: zh/en meta present (client matches only zh|en locale ids)', () => {
  for (const lang of ['zh', 'en']) {
    const locale = JSON.parse(read(`locale/${lang}.json`))
    assert.equal(typeof locale.meta.title, 'string')
    assert.equal(typeof locale.meta.description, 'string')
    assert.notEqual(locale.meta.description, '')
  }
})

test('locale: meta.detail names an existing per-language user doc (plugin-page detail source)', () => {
  for (const lang of ['zh', 'en']) {
    const locale = JSON.parse(read(`locale/${lang}.json`))
    const detail = locale.meta.detail
    // Official rule (plugin-detail readPackageDocument): '/'-separated,
    // package-root-relative, .md/.markdown suffix, no ./.. segments,
    // no backslash, no URL scheme; a missing named file is a hard failure
    // (no README fallback), so the target MUST exist.
    assert.equal(typeof detail, 'string')
    assert.match(detail, /\.(md|markdown)$/)
    assert.ok(!detail.includes('\\') && !detail.includes(':'))
    assert.ok(detail.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'))
    assert.ok(existsSync(path.join(root, detail)), `${detail} exists`)
  }
})

test('client half: prebuilt factory file — classic script shape, package-name id, apply/inject tail', () => {
  const source = read('client/index.js')
  // Classic script served verbatim: no ESM syntax survives the check.
  assert.match(source, /window\.__ModuleLoader__\.load\(\{\s*\n\s*id: 'dsh-mm-resilience'/)
  assert.doesNotMatch(source, /^\s*export\s/m)
  assert.doesNotMatch(source, /^\s*import\s/m)
  assert.match(source, /exports\.apply\s*=\s*apply/)
  assert.match(source, /exports\.inject\s*=\s*inject/)
  assert.doesNotMatch(source, /=>\s*<[A-Za-z]/, 'no JSX')
})
