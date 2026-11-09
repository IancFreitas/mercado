# iOS/Safari para PWA, Siri/Atalhos e iCloud: limitações reais

> Autor: Agente 5. Data: 2026-11-03. Alvo: iOS/iPadOS 17, 18 e posteriores; PWA no GitHub
> Pages, local-first (IndexedDB), sync via Supabase.
> Legenda: **[V]** verificado nesta sessão · **[D]** documentado por terceiros (WebKit, Apple,
> MDN, caniuse) · **[H]** hipótese ou comportamento a confirmar num iPhone real.
> **Nada deste arquivo foi testado num aparelho nesta sessão.** O ambiente é Linux, sem
> Safari, então nenhum item é [V]. Antes de fechar a arquitetura, rode a checklist da seção 5
> num iPhone.

## 1. Resumo executivo

- Uma web app na Tela de Início tem **armazenamento próprio, separado do Safari**. Login,
  IndexedDB e cookies do Safari não passam para o PWA, nem o contrário.
- O IndexedDB de uma web app na Tela de Início **não sofre o corte de 7 dias do ITP** enquanto
  o app é usado, mas ainda pode ser removido por pressão de espaço. Use
  `navigator.storage.persist()` (Safari 17+) e trate o Supabase como backup real.
- Câmera via `getUserMedia` funciona em modo standalone. `BarcodeDetector` **não** deve ser
  considerado disponível: use um polyfill em WASM (ZXing).
- Web Push funciona só com o app instalado na Tela de Início (iOS 16.4+). Background Sync,
  Periodic Sync, Background Fetch e Web Share Target **não existem** no iOS.
- **Magic link abre no Safari, não no PWA.** Use OTP de 6 dígitos digitado dentro do PWA.
- Siri não tem acesso ao PWA nem ao IndexedDB. Comandos por voz dependem de Atalhos que
  chamam uma API (Supabase Edge Function) com token próprio, ou que abrem uma URL no Safari.
- Não existe gravação no iCloud Drive em segundo plano. Use exportação manual (Web Share
  → "Salvar em Arquivos") ou um Atalho agendado que baixa o backup da API e salva o arquivo.

## 2. Limitações do Safari/WebKit para o PWA

### 2.1 Armazenamento separado (Safari x Tela de Início) [D]
- Desde o iOS 14, uma web app aberta da Tela de Início (`display: standalone`) roda num
  contêiner de dados próprio. Cookies, `localStorage`, IndexedDB, Cache Storage e service
  worker **não são compartilhados** com as abas do Safari do mesmo domínio.
- Consequências: (1) o usuário faz login **de novo** depois de instalar; (2) qualquer link
  externo (e-mail, Atalhos, QR Code da NFC-e) abre no **Safari**, com outro banco local;
  (3) o sync pelo Supabase é a única ponte entre os dois contextos.
- No GitHub Pages, `https://<user>.github.io/<repo>/` compartilha a origem
  `<user>.github.io` com **todos os outros repositórios Pages do mesmo usuário**. Isso vale
  para IndexedDB, cota e `persist()`. Recomendo domínio próprio ou um usuário/organização
  dedicado. [D: regra de same-origin]

### 2.2 Persistência e eviction do IndexedDB [D]
- **ITP (Safari 13.1 / iOS 13.4, 2020):** quando o usuário passa 7 dias usando o Safari sem
  interagir com o site, todo o armazenamento gravável por script (IndexedDB, localStorage,
  service worker, Cache) daquele site é apagado. O WebKit informa que web apps na Tela de
  Início têm contador próprio de "dias de uso" e que, sendo o próprio site o first party, os
  dados não são apagados por essa regra enquanto o app é usado.
  Fonte: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- **Política de armazenamento do Safari 17 / iOS 17:** a cota por origem fica em torno de 60%
  do disco para navegadores (cerca de 15% em apps com WKWebView). Há eviction por LRU quando o
  espaço acaba. `navigator.storage.estimate()` e `navigator.storage.persist()` passam a
  existir. Uma origem marcada como persistente sai da eviction automática. A concessão é
  heurística e não abre prompt. **[H]** A chance de concessão é maior para web apps na Tela de
  Início. Fonte: https://webkit.org/blog/14403/updates-to-storage-policy/
- Recomendações: chamar `persist()` depois do login e mostrar o resultado nas configurações;
  manter uma fila de sync durável; sincronizar ao abrir e ao voltar ao primeiro plano
  (`visibilitychange`), já que não há sync em segundo plano; e oferecer exportação JSON.
- O usuário pode apagar tudo em Ajustes > Safari > Avançado > Dados dos Sites, ou removendo o
  ícone da Tela de Início. **[H]** Remover o ícone apaga o contêiner da web app.

### 2.3 Câmera (getUserMedia) em modo standalone [D/H]
- `getUserMedia` funciona em web apps na Tela de Início desde o iOS 13.4. Exige HTTPS e gesto
  do usuário. O `<video>` precisa de `playsinline` e `muted`.
- **[H/D comunitário]** A permissão de câmera nem sempre persiste entre sessões no modo
  standalone, e o prompt pode voltar. Pare as tracks ao sair da tela (`track.stop()`).
- Plano B sem `getUserMedia`: `<input type="file" accept="image/*" capture="environment">`,
  que abre a câmera nativa e devolve uma foto para decodificar.

### 2.4 BarcodeDetector [D/H]
- A Shape Detection API (`BarcodeDetector`) não aparece como suportada no Safari iOS nas
  tabelas do caniuse/MDN. Ela existe no WebKit só atrás de flag experimental.
  Fonte: https://caniuse.com/mdn-api_barcodedetector
- Decisão: usar o polyfill `barcode-detector` (ZXing-C++ em WASM) ou `@zxing/browser`, que
  leem EAN-13/EAN-8 (produtos) e QR Code (NFC-e). Faça feature-detect antes e use o nativo
  quando houver.

### 2.5 Notificações: Web Push [D]
- iOS/iPadOS 16.4+: Push API + Notifications API **apenas** para web apps adicionadas à Tela
  de Início, com `Notification.requestPermission()` chamado por gesto do usuário. Usa VAPID
  padrão (sem conta Apple Developer). Badging API (`navigator.setAppBadge`) também existe.
  Fonte: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- O iOS 18.4 trouxe o "Declarative Web Push", que entrega a notificação sem depender do
  service worker. Fonte: https://webkit.org/blog/16535/meet-declarative-web-push/
- O envio precisa de backend (Edge Function + `pg_cron`, por exemplo: "o arroz vence amanhã").
  **Não há código rodando em segundo plano no aparelho** além do handler `push`, e o push
  precisa sempre mostrar uma notificação (nada de push silencioso).

- **Implementado (sem servidor):** selo no ícone (Badging API) com o nº de sugestões de reposição e um aviso local ao abrir o app (no máx. 1 por dia, opt-in em Casa › Avisos, permissão pedida só por gesto). **Push remoto ficou de fora:** exige servidor e chave VAPID secreta (gravar credencial depende de pedido explícito do dono). Código em `src/notify/`.

### 2.6 Sem execução em segundo plano [D]
- Background Sync (`SyncManager`), Periodic Background Sync e Background Fetch: **não
  suportados**. O sync só acontece com o app aberto. Fonte: https://caniuse.com/background-sync
- Não existe `beforeinstallprompt`. A instalação é manual: Compartilhar → "Adicionar à Tela de
  Início". O app deve ter uma tela de instruções. **[D]** Desde o iOS 16.4, outros navegadores
  (Chrome, Edge) também instalam. **[H]** No iOS 26, sites adicionados abrem como web app por
  padrão.

### 2.7 Arquivos [D]
- File System Access API (`showOpenFilePicker`, `showSaveFilePicker`): **não suportada**.
- OPFS (`navigator.storage.getDirectory()`): suportado (Safari 15.2+, com
  `createSyncAccessHandle` em worker a partir do 16.4). É privado à origem e invisível no app
  Arquivos.
- `<input type="file">` abre o seletor do sistema, inclusive para o iCloud Drive. Serve para
  **importar** backup.
- `<a download>` com Blob: funciona no Safari (vai para Downloads no app Arquivos). **[H]** No
  modo standalone, às vezes abre uma pré-visualização em vez de baixar. Prefira Web Share.

### 2.8 Web Share API e Web Share Target [D]
- `navigator.share({title,text,url})`: iOS 12.2+. Compartilhar **arquivos**
  (`navigator.canShare({files})`): iOS 15+. Exige gesto do usuário.
- **Web Share Target** (`share_target` no manifest): **não suportado no iOS**. O PWA não
  aparece na folha de compartilhamento, então não dá para "compartilhar a página da SEFAZ
  com o Smart Pantry". O caminho é copiar e colar (ver NFCE_SP.md, Camada 1).
- `navigator.clipboard.readText()`: suportado, com gesto do usuário. O iOS mostra a bolha
  "Colar" para confirmar.

### 2.9 Login: magic link x OTP de 6 dígitos [D/H]
- O link do e-mail abre no navegador padrão (Safari), **nunca** no PWA da Tela de Início.
  Universal Links não apontam para web apps. A sessão do Supabase fica no armazenamento do
  Safari (2.1), e o PWA continua deslogado.
- **OTP de 6 dígitos** resolve isso. O usuário continua no PWA, lê o código no Mail e digita.
  No Supabase: `signInWithOtp({ email, options: { shouldCreateUser } })` e depois
  `verifyOtp({ email, token, type: 'email' })`, com o template de e-mail mostrando
  `{{ .Token }}` em vez de (ou junto com) `{{ .ConfirmationURL }}`.
  Fonte: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Use `<input inputmode="numeric" autocomplete="one-time-code" maxlength="6">`. **[D]** No iOS
  17+, o teclado sugere códigos que chegam no Mail. Cuide da expiração (padrão de 1 h) e do
  rate limit de envio.
- Depois do login, o refresh token fica no `localStorage`/IndexedDB do PWA. Se for apagado
  (2.2), o usuário precisa entrar de novo.

### 2.10 Outros pontos
- União Europeia (DMA): no beta do iOS 17.4, a Apple anunciou que removeria web apps da Tela
  de Início e depois voltou atrás. Elas continuam funcionando com WebKit. [D]
- Vibration API: não suportada. Screen Wake Lock: 16.4+ (no modo standalone, corrigido no
  18.4). [D]

## 3. Siri e Atalhos

Premissas: (1) Siri e Atalhos **não** conseguem chamar código do PWA nem ler o IndexedDB.
Web apps não expõem App Intents. (2) Existem duas formas de integrar: **"Abrir URL"**, que
abre o **Safari** (não o PWA, ver 2.1), e **"Obter conteúdo da URL"**, que faz uma chamada
HTTP com método, cabeçalhos e corpo JSON, sem abrir nada. (3) Cada Atalho é ativado por voz
pelo nome ("E aí Siri, <nome do atalho>"), e "Falar texto"/"Mostrar resultado" devolve a
resposta.

Infraestrutura necessária para os comandos de API ("Infra-A"):
- Edge Function `assistant` (`/functions/v1/assistant/{missing|add|spend|stock}`).
- **Token pessoal de Atalho**: valor aleatório gerado no app, mostrado uma vez e guardado
  como hash numa tabela `shortcut_tokens(user_id, household_id, scopes, revoked_at)`. A função
  valida o token e consulta com service role **filtrando pelo household**. Não use o JWT do
  usuário (expira em ~1 h) nem a anon/service key dentro do Atalho.
- O token fica em texto puro dentro do Atalho. Se o Atalho for compartilhado, o token vaza.
  Por isso: escopos mínimos, revogação na UI e rate limit.
- Os dados respondidos são os **já sincronizados**. Mudanças pendentes no IndexedDB do
  iPhone não aparecem.

| Comando | Classificação | Mecanismo |
|---|---|---|
| "Abra minha lista de compras." | **Viável com limitações** | Atalho "Abrir URL" `https://<host>/#/list`. Abre no **Safari**, não no ícone instalado, com outro login e outro banco local, que convergem pelo sync. **[H]** Dizer "Abrir Smart Pantry" à Siri pode não encontrar a web app, porque a ação "Abrir App" lista apps nativos. Testar no aparelho. |
| "Adicione leite à lista de compras." | **Viável e implementável** (via API) / limitada (via URL) | (1) Recomendado: "Pedir entrada"/"Ditar texto", depois "Obter conteúdo da URL" com POST `…/assistant/add` `{ "name": "leite" }`, `Authorization: Bearer <token>`, depois "Falar texto". Depende da Infra-A, mas é simples. (2) Sem backend: "Abrir URL" `https://<host>/#/list?add=leite`. O app lê o parâmetro, pede confirmação, adiciona e limpa a URL. Funciona, mas abre o Safari (limitação acima). |
| "O que está faltando em casa?" | **Dependente de infraestrutura adicional** | GET `…/assistant/missing`, que devolve um texto pronto ("Faltam: leite, arroz e café"). "Falar texto". Requer a Infra-A e um campo de status/estoque mínimo nos itens. |
| "Quanto gastamos no supermercado este mês?" | **Dependente de infraestrutura adicional** | GET `…/assistant/spend?period=month` soma as compras (NFC-e ou manuais) do household no mês, no fuso `America/Sao_Paulo`. A precisão depende de as compras terem sido registradas e sincronizadas. |
| "O arroz está acabando?" | **Dependente de infraestrutura adicional** (resposta útil exige modelo de consumo) | Pedir ou ditar o produto, depois GET `…/assistant/stock?q=arroz`, com busca aproximada (`pg_trgm`/`unaccent`) e resposta conforme quantidade x mínimo, ou previsão por consumo médio. Sem estoque atualizado, a resposta é só um palpite. |

Nenhum comando é "não viável" enquanto existir backend. **Seriam não viáveis** apenas se
dependessem de ler o IndexedDB local ou de rodar sem rede.

Distribuição: publicar os Atalhos por link do iCloud (`https://www.icloud.com/shortcuts/…`)
**sem** o token embutido, usando "Pedir entrada" na importação (Import Questions). Assim o
usuário cola o token gerado no app.

## 4. iCloud

- **[D]** Uma web app não tem API para iCloud Drive e não roda em segundo plano. **Não dá**
  para gravar backups no iCloud sozinha. CloudKit JS existe, mas usa um contêiner CloudKit do
  desenvolvedor (conta Apple Developer, login com Apple ID no web) e não aparece como arquivo
  no iCloud Drive. É infraestrutura extra sem ganho real sobre o Supabase. Não recomendado.
- **Exportação manual (viável e implementável):** botão "Exportar backup" gera um
  `Blob` JSON (`smart-pantry-AAAA-MM-DD.json`). Em seguida,
  `navigator.share({ files: [new File([blob], name, { type: 'application/json' })] })` abre a
  folha de compartilhamento, onde o usuário toca "Salvar em Arquivos" → iCloud Drive. Plano
  B: `<a download>`. Exige gesto do usuário a cada exportação.
- **Importação:** `<input type="file" accept="application/json,.json">`, com o arquivo vindo do
  iCloud Drive. Validar esquema/versão e mesclar por ID e `updated_at`.
- **Backup automático via Atalho (depende de infraestrutura):** uma Automação Pessoal
  ("Diariamente às 03:00", execução sem confirmação, possível desde o iOS 15/17) faz "Obter
  conteúdo da URL" GET `…/assistant/export` (token com escopo `export`) e depois "Salvar
  Arquivo" em `iCloud Drive/Smart Pantry/` sem perguntar. Exporta os dados **do servidor**,
  não o IndexedDB local. **[H]** Confirmar no aparelho se a automação roda com o iPhone
  bloqueado.
- Seja claro com o usuário: o "backup no iCloud" é uma **cópia exportada**, não um sync. A
  fonte de verdade entre dispositivos continua sendo o Supabase.

## 5. Checklist de validação num iPhone (iOS 17/18/26)

1. Instalar pela Tela de Início e confirmar que a sessão do Safari não aparece no PWA (2.1).
2. `await navigator.storage.persist()` e `estimate()`: registrar o resultado no PWA e no Safari.
3. Leitor ZXing (EAN-13 e QR NFC-e) com `getUserMedia` no standalone: o prompt volta depois de
   fechar e reabrir o app?
4. `'BarcodeDetector' in window` no Safari iOS atual.
5. Web Push: pedir permissão por botão, receber push de teste via Edge Function.
6. `navigator.canShare({files:[jsonFile]})` e "Salvar em Arquivos" no standalone; testar `<a download>`.
7. OTP: receber o código, ver a sugestão no teclado e confirmar que a sessão persiste depois
   de fechar o app.
8. Atalhos: "Abrir URL" com `#/list?add=leite` (abre Safari ou PWA?); "Obter conteúdo da URL"
   POST com Bearer; "Abrir App" lista a web app?
9. Automação diária salvando arquivo no iCloud Drive com o aparelho bloqueado.

## 6. Fontes principais

- WebKit: ITP e web apps na Tela de Início: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- WebKit: Updates to Storage Policy (Safari 17): https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit: Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit: Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
- caniuse: BarcodeDetector, Background Sync, Web Share, File System Access: https://caniuse.com/
- MDN: Web Share API, Storage API, Web App Manifest `share_target`: https://developer.mozilla.org/
- Supabase: Passwordless email / OTP: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Apple: Guia do Usuário de Atalhos ("Obter conteúdo da URL", Automação Pessoal): https://support.apple.com/guide/shortcuts/welcome/ios
