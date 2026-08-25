# Claude Token Monitor

App Electron (vanilla JS, sem framework) que lê os arquivos de sessão do Claude Code
(`~/.claude/projects/**/*.jsonl`) e mostra o consumo histórico de tokens em gráficos
de pizza e uma tabela ordenável — tudo local e offline.

## Rodar

```bash
npm install
npm start
```

## O que o app mostra

- Gráfico de pizza com tokens por sessão (top 8 + "Outras" agrupado), com legenda
  legível (projeto, uuid curto da sessão, total formatado em K/M/B).
- Gráfico de pizza com tokens por categoria (input, output, cache creation, cache read),
  somado globalmente.
- Tabela ordenável com todas as sessões (projeto, cwd, última atividade, tokens por
  categoria e total), com filtro por texto.
- Botão de atualizar, que re-varre os arquivos JSONL do zero.

Não busca nem infere limites de plano (Pro/Max) — isso não tem API pública. É só
visualização de consumo histórico local.

## Como funciona (arquitetura)

- **Main process** (`main.js`): varre recursivamente `~/.claude/projects`, faz stream
  linha a linha (NDJSON) de cada `.jsonl` com `readline` — nunca `readFileSync` do
  arquivo inteiro, pois os arquivos podem ser grandes. Agrega por `sessionId`, usando
  `cwd` da própria sessão para o nome do projeto. Exposto ao renderer só por
  `ipcMain.handle('tokens:scan')`.
- **Preload** (`preload.js`): único ponto de contato do renderer com o main process,
  via `contextBridge.exposeInMainWorld('tokenMonitorAPI', { scanSessions })`.
- **Renderer** (`renderer/`): vanilla JS + Chart.js (instalado via npm e copiado para
  `renderer/chart.umd.js` no `postinstall`, sem CDN) para os dois gráficos de pizza,
  além da tabela e dos cards de resumo. Tipografia (Fraunces, Inter, JetBrains Mono)
  também é instalada via npm (`@fontsource/*`) e copiada para `renderer/fonts/` no
  `postinstall` — sem Google Fonts, sem CDN, funciona 100% offline.

Segurança: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
CSP restritiva (`script-src 'self'`) no `index.html`, e navegação/pop-ups bloqueados
no main process.

## Empacotar (build para distribuição)

```bash
npm run dist:mac    # dmg + zip, arm64 + x64
npm run dist:linux  # AppImage
npm run dist:win    # instalador NSIS
npm run dist        # os três de uma vez
```

Os instaladores saem em `dist/` (pastas `*-unpacked` são apenas estágio
intermediário do `electron-builder`, não são o artefato final). Ícone próprio em
`build/icon.icns` / `.ico` / `.png`, gerado a partir de `scripts/icon-design.html`
via `scripts/generate-icon.js` + `scripts/build-ico.js`.
