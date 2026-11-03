# Viabilidade: leitura de NFC-e de São Paulo no Smart Pantry

> Autor: Agente 5 (NFC-e e Processamento). Data da pesquisa: 2026-11-03.
> Legenda de confiabilidade usada em todo o documento:
> - **[V]** verificado nesta sessão, com comando e resultado reproduzidos abaixo;
> - **[D]** documentado por terceiros (manual/NT da SEFAZ, projetos open-source), não reexecutado aqui;
> - **[H]** hipótese não verificada.

## 1. Resumo executivo

1. **[V]** Nenhum endpoint de consulta NFC-e testado (SP homologação, SP produção, RS, PR) devolve
   `Access-Control-Allow-Origin`. Um `fetch()` feito por um PWA em `*.github.io` será bloqueado
   pelo navegador. **Buscar direto do PWA não é viável.**
2. **[V]** A produção de SP (`www.nfce.fazenda.sp.gov.br`) responde `Request Rejected` (WAF F5,
   cookie `TS…`) para **qualquer** caminho, até `/`, a partir do IP de saída desta sessão
   (Google Cloud, Iowa, EUA). **[H]** O bloqueio provavelmente é por geografia ou reputação do IP
   (datacenter fora do Brasil). Isso afeta diretamente a opção de proxy serverless.
3. **[V]** Em homologação de SP, a URL do QR Code (`/qrcode?p=…` → `ConsultaQRCode.aspx`)
   **não tem CAPTCHA**. Ela valida o DV da chave e retorna o erro "Documento Fiscal (NFC-e)
   Inexistente". Já a consulta manual pela chave (`ConsultaPublica.aspx`) **tem CAPTCHA** de
   imagem/áudio e carrega `recaptcha/api.js`.
4. A recomendação é uma estratégia em camadas, sem burlar controles (seção 6):
   parse local da chave → abrir a página da SEFAZ no Safari e o usuário colar/compartilhar o
   conteúdo → digitação manual. O proxy serverless fica como experimento opcional (com ressalvas).

## 2. Formato do QR Code da NFC-e

### 2.1 Chave de acesso (44 dígitos) [D, com DV verificado localmente]

| Posição | Tam. | Campo | Exemplo (fictício) |
|---|---|---|---|
| 1-2 | 2 | cUF (código IBGE da UF; SP=35, RJ=33, MG=31, PR=41, RS=43) | `35` |
| 3-6 | 4 | AAMM da emissão | `2601` |
| 7-20 | 14 | CNPJ do emitente (ou CPF com zeros à esquerda, em casos específicos) | `00000000000191` |
| 21-22 | 2 | Modelo (`65` = NFC-e, `55` = NF-e) | `65` |
| 23-25 | 3 | Série | `001` |
| 26-34 | 9 | Número da nota (nNF) | `000000001` |
| 35 | 1 | tpEmis (1=normal; 9=contingência offline NFC-e) | `1` |
| 36-43 | 8 | cNF (código numérico aleatório) | `00000001` |
| 44 | 1 | cDV (dígito verificador, módulo 11) | `4` |

DV módulo 11: aplique pesos 2,3,…,9 (e reinicie em 2) da direita para a esquerda sobre os
43 primeiros dígitos, some e calcule `r = soma % 11`. Se `r < 2`, o DV é 0. Caso contrário,
o DV é `11 - r`. **[V]** Implementado em Python nesta sessão. A chave fictícia
`3526010000000000019165001000000001100000001` gerou DV `4`, e a SEFAZ-SP de homologação
aceitou esse DV, passando da validação de DV para a de existência (ver 3.3).

```ts
export function dvMod11(k43: string): number {
  let s = 0; const w = [2,3,4,5,6,7,8,9];
  [...k43].reverse().forEach((d, i) => { s += Number(d) * w[i % 8]; });
  const r = s % 11; return r < 2 ? 0 : 11 - r;
}
```

### 2.2 Parâmetro `p` do QR Code [D]

Fontes: Manual de Especificações Técnicas do DANFE NFC-e e QR Code (v5.x, QR Code versão 2),
NT 2015.002 e NT 2025.001 (QR Code versão 3). Portal: https://www.nfce.encat.org/ e
https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY=

- **Versão 1 (legado, extinta):** `?chNFe=…&nVersao=100&tpAmb=…&dhEmi=<hex>&vNF=…&vICMS=…&digVal=<hex>&cIdToken=…&cHashQRCode=…`.
  Notas antigas podem trazer esse formato. Basta extrair `chNFe`.
- **Versão 2.00, emissão online (tpEmis=1):**
  `p=<chave44>|2|<tpAmb>|<cIdToken>|<cHashQRCode>`
  (`cHashQRCode` = SHA-1 hex de `chave|2|tpAmb|cIdToken` concatenado ao CSC).
- **Versão 2.00, contingência offline (tpEmis=9):**
  `p=<chave44>|2|<tpAmb>|<dia dhEmi DD>|<vNF>|<digVal hex>|<cIdToken>|<cHashQRCode>`.
  Aqui o QR já traz o valor total e o dia, úteis mesmo sem consultar a SEFAZ.
- **Versão 3.00 (NT 2025.001, sem CSC):** online `p=<chave44>|3|<tpAmb>`. Na contingência
  offline o QR traz dados adicionais (dia, vNF, identificação do destinatário e assinatura
  digital no lugar do hash com CSC). **[H]** A ordem exata dos campos offline v3 deve ser
  conferida na NT vigente antes de implementar. **[V]** A SEFAZ-SP homologação aceitou
  `p=<chave>|3|2` (ver 3.3).
- `tpAmb`: 1 = produção, 2 = homologação.

O parser do app deve: (1) aceitar a URL inteira ou só o `p`; (2) fazer `decodeURIComponent`
(`|` vem como `%7C`); (3) separar por `|`; (4) validar 44 dígitos, modelo `65` e DV; (5)
guardar a URL original para reabrir depois.

### 2.3 URLs de consulta por UF [D, com testes em 3.x]

| UF | URL do QR Code (produção) | Consulta por chave |
|---|---|---|
| SP | `https://www.nfce.fazenda.sp.gov.br/qrcode` (redireciona para `/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx`) | `https://www.nfce.fazenda.sp.gov.br/consulta` → `ConsultaPublica.aspx` |
| SP homolog. | `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode` | `…/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx` |
| RJ | `https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode` | `http://www.fazenda.rj.gov.br/nfce/consulta` |
| MG | `https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml` | `https://portalsped.fazenda.mg.gov.br/portalnfce` |
| PR | `http://www.fazenda.pr.gov.br/nfce/qrcode` | `http://www.fazenda.pr.gov.br/nfce/consulta` |
| RS | `https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx` (redireciona para `dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce`) | `https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx` |

A lista oficial completa e atualizada fica na tabela "URLs do QR Code e de consulta por chave"
do portal ENCAT. Na prática, o app não precisa dessa tabela, porque **a URL vem dentro do
próprio QR Code**. Basta abri-la como está.

## 3. Testes reais com curl [V]

Ambiente: saída pelo proxy da sessão, IP `AS396982 Google LLC`, Iowa, US (`curl ipinfo.io/json`).
User-Agent de iPhone Safari 18, cabeçalho `Origin: https://example.github.io`. Só foram
usadas chaves **fictícias** (CNPJ `00000000000191`, número 1).

### 3.1 SP produção: bloqueio por WAF

```
$ P='35260100000000000191650010000000011000000010%7C2%7C1%7C1%7C0000…'
$ curl -sS -D - -A "$UA_IPHONE" -H 'Origin: https://example.github.io' \
    "https://www.nfce.fazenda.sp.gov.br/qrcode?p=$P"
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 245
X-Frame-Options: SAMEORIGIN
Set-Cookie: TS6b870055027=0875…; Path=/
<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.
Please consult with your administrator.<br><br>Your support ID is: <10138580085970595505>…
```

- O mesmo corpo de 245 bytes volta para `/`, `/qrcode`, `/consulta`, `ConsultaQRCode.aspx`,
  `ConsultaPublica.aspx`, com ou sem `Origin`/UA, com `|` cru ou `%7C`, e também em `OPTIONS`.
- Não há redirecionamento, `Access-Control-Allow-Origin` nem CAPTCHA, porque a página real
  nunca é servida. A página de bloqueio do F5 BIG-IP ASM aparece com status 200 e cookie `TS…`.
- `https://portal.fazenda.sp.gov.br/servicos/nfce` (portal institucional) responde 200 com
  ViewState e CSP permitindo `google.com/recaptcha`. O WAF não bloqueia o domínio inteiro.

### 3.2 SP homologação: página de consulta pública manual (com CAPTCHA)

```
$ curl -sS -L -D h.txt -o cp.html -A "$UA_IPHONE" -H 'Origin: https://example.github.io' \
    https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx
HTTP/1.1 200 OK
Set-Cookie: ASP.NET_SessionId=cp1e…; path=/; HttpOnly; SameSite=Lax
Set-Cookie: __AntiXsrfToken=dee6…; path=/; HttpOnly
Set-Cookie: TS0113898b=0174…
(sem Access-Control-Allow-Origin)
$ grep -oiE 'recaptcha|captcha|__VIEWSTATE|__EVENTVALIDATION' cp.html | sort | uniq -c
  7 Captcha / 4 captcha / 1 recaptcha / 2 __VIEWSTATE / 2 __EVENTVALIDATION
```

O formulário tem `Conteudo_txtChaveAcesso`, a imagem `ImageRand`
(`Captcha/RandomImageHandler.ashx`), áudio (`Captcha/Som.ashx`), o campo `txCodigo`
(maxlength 6, "Digite os caracteres da imagem ao lado") e o script `recaptcha/api.js`.
**Consultar pela chave digitada exige resolver CAPTCHA**, e o app não deve automatizar isso.

### 3.3 SP homologação: URL do QR Code (sem CAPTCHA)

```
$ curl -sS -L -D h.txt -o q.html -A "$UA_IPHONE" \
  "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=<chave fictícia DV errado>%7C2%7C2%7C1%7C000…"
HTTP/1.1 302 Redirect
Location: https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=…
HTTP/1.1 200 OK   (20363 bytes; ASP.NET_SessionId, __AntiXsrfToken, TS0113898b; __VIEWSTATE x2)
$ grep -o "spnErro…html('…')" q.html
…QR Code inválido. Erro(s): - Dígito verificador Chave de Acesso do QR Code inválido
```

Com DV válido (`35260100000000000191650010000000011000000014`):

```
p=<chave>|2|2|1|000…  -> "Documento Fiscal (NFC-e) Inexistente na Base de Dados da Sefaz."
p=<chave>|3|2         -> "Documento Fiscal (NFC-e) Inexistente na Base de Dados da Sefaz."
```

- Nenhuma ocorrência de `captcha`/`recaptcha`/`hcaptcha` na página do QR Code.
- `OPTIONS` com `Access-Control-Request-Method: GET` → `200`, `Allow: OPTIONS, TRACE, GET, HEAD, POST`,
  **sem** cabeçalhos `Access-Control-*`. Preflight e GET simples falhariam no navegador.
- **[H]** O comportamento em produção (com uma nota real e de um IP brasileiro) deve ser
  parecido, mas não foi possível confirmar por causa do WAF.

### 3.4 Outras UFs (GET sem `p`, exceto RS)

| UF | Resultado |
|---|---|
| RJ `consultadfe.fazenda.rj.gov.br` | `curl: (52) Empty reply from server`, sem HTTP. **[H]** Bloqueio de IP estrangeiro. |
| MG `portalsped.fazenda.mg.gov.br` | Timeout de 25 s sem bytes. **[H]** Idem. |
| PR `www.fazenda.pr.gov.br/nfce/qrcode` | 302 → https → 302 `/system/error` (sem `p`). Sem ACAO e sem captcha. |
| RS `NFCE-COM.aspx?p=…` | 302 → `dfe-portal.svrs.rs.gov.br/Dfe/QrCodeNFce?p=…`. Sem `p`, cai no login gov.br (hCaptcha). Sem ACAO. |

## 4. O PWA consegue buscar direto? Não.

- **CORS [V]:** nenhuma resposta tem `Access-Control-Allow-Origin`. O `fetch` do GitHub Pages
  falha. `mode: 'no-cors'` gera uma resposta opaca, sem acesso ao corpo.
- **iframe [V/H]:** a produção de SP envia `X-Frame-Options: SAMEORIGIN` (visto na resposta do
  WAF) e, mesmo que carregasse, o PWA não lê o DOM de outra origem.
- **Estado ASP.NET [V]:** ViewState, `__AntiXsrfToken` e cookie de sessão. O resultado aparece
  na própria página, via GET no fluxo do QR, sem precisar de postback.
- **Rede [V]:** WAF/geo-bloqueio a partir de datacenter fora do Brasil (SP, RJ, MG).

## 5. Alternativas legítimas

| # | Estratégia | Itens? | Prós | Contras/Riscos |
|---|---|---|---|---|
| a | **Abrir a URL do QR no Safari** (`window.open`/link) e o usuário copiar, compartilhar ou salvar como PDF/texto, depois colar no app | Sim | Usa a sessão e o IP do próprio usuário; não automatiza nada; legal | Exige ação manual; colar texto puro perde estrutura (parser tolerante a texto); "Compartilhar → Copiar" no Safari copia só a URL |
| b | **Proxy serverless** (Supabase Edge Function / Cloudflare Worker) fazendo GET na URL do QR | Sim | Experiência de um clique | **[V]** IPs de datacenter fora do BR são bloqueados; Supabase pode rodar em `sa-east-1` (São Paulo), mas **[H]** IPs de nuvem podem continuar bloqueados; sem termos de uso que autorizem; rate limit; manutenção se o HTML mudar; LGPD (CPF opcional na nota, histórico de compras) |
| c | **Parse local da chave** | Não | Offline, instantâneo, 100% confiável: UF, mês/ano, CNPJ, número, série, tipo de emissão; no QR offline v2 também dia e valor total | Não traz itens nem nome da loja (CNPJ → nome exige base própria ou digitação) |
| d | **OCR** do cupom impresso (Tesseract.js/WASM no cliente) | Parcial | Funciona sem rede | Cupom térmico, abreviações, colunas; precisão baixa; pesado no iPhone |
| e | **Manual** (lançar total ou itens) | Sim | Sempre funciona | Trabalhoso |

Notas sobre (b), se for experimentado:
- Faça apenas GET na URL pública do QR Code, que não tem CAPTCHA em homologação. **Nunca** use
  `ConsultaPublica.aspx` (CAPTCHA) nem serviços de resolução de captcha.
- Exija usuário autenticado, permita só os hosts oficiais (SSRF), limite a ~1 requisição por
  nota, use cache por chave e não guarde HTML bruto. Respeite qualquer bloqueio (403/"Request
  Rejected") sem tentar contornar com proxies residenciais.
- Avaliação jurídica [H]: o conteúdo é público para quem tem o QR, e o titular é quem consulta
  a própria nota, mas não há API oficial nem termo autorizando acesso automatizado. Trate como
  "melhor esforço", desligável por feature flag.

## 6. Estratégia recomendada em camadas

1. **Camada 0 (sempre):** ler o QR com a câmera e fazer o parse local. Registrar a "compra"
   com chave, CNPJ, data (AAMM, mais o dia/vNF se o QR for offline), UF e link. Deduplicar pela
   chave de 44 dígitos.
2. **Camada 1 (padrão para itens):** botão "Ver nota na SEFAZ". Ele abre a URL do QR no
   Safari, e o usuário seleciona tudo, copia e volta ao app, que lê a área de transferência
   (`navigator.clipboard.readText()` com gesto do usuário) ou recebe o texto colado num
   `<textarea>`. Um parser tolerante converte o texto (padrões `Qtde.:`, `UN:`, `Vl. Unit.:`,
   `Vl. Total`, `Valor a pagar R$`) em itens. Também aceita HTML colado, quando houver.
3. **Camada 2 (opcional/experimental):** proxy em Edge Function com as restrições da seção 5,
   desligado por padrão. Testar primeiro em `sa-east-1`. Se receber "Request Rejected", cair
   para a Camada 1.
4. **Camada 3:** lançamento manual (total, ou itens rápidos com autocompletar do catálogo).
   OCR fica para depois, como melhoria.

## 7. Estrutura HTML esperada da página de resultado (SP e layout comum)

**[D]** Confirmada por três projetos open-source independentes que fazem parse dessa página
(códigos lidos nesta sessão via raw.githubusercontent.com):
- https://github.com/elisasmenendez/nfce-api (`nfce-api.py`, BeautifulSoup)
- https://github.com/Bleachless/racha-pix (`src/lib/nfce.ts`, "layout padrão que a maioria das Sefaz usa")
- https://github.com/Matheuszl/mercado-em-caixinhas (`src/lib/nfce-parse.ts`)

**[H]** Não foi possível ver uma nota real de SP nesta sessão (WAF em produção, nota
inexistente em homologação).

| Seletor | Conteúdo |
|---|---|
| `div#conteudo div.txtCenter` | Bloco do emitente |
| `.txtTopo` (ou `#u20`) | Razão social / nome fantasia |
| `.txtCenter .text` [0] | `CNPJ: 00.000.000/0001-91` |
| `.txtCenter .text` [1] | Endereço |
| `table#tabResult tr` | Uma linha por item (`td`[0] = descrição, `td`[1] = valor) |
| `span.txtTit` (às vezes `txtTit2`) | Descrição do produto |
| `span.RCod` | `(Código: 7891234567890)`, pode ser GTIN/EAN ou código interno |
| `span.Rqtd` | `Qtde.:1,234` |
| `span.RUN` | `UN: KG` |
| `span.RvlUnit` | `Vl. Unit.: 9,99` |
| `td span.valor` | Valor total do item (`12,33`) |
| `div#totalNota` > `div` com `label` + `span.totalNumb` | `Qtd. total de itens`, `Valor total R$`, `Descontos R$`, `Valor a pagar R$` |
| `.totalNumb.txtMax` | Valor a pagar (destaque) |
| `div#infos` | Número, série, data/hora `dd/mm/aaaa hh:mm:ss`, protocolo |
| `span.chave` | Chave de acesso formatada (grupos de 4) |
| `div.avisoErro` / `.alert-danger` | Mensagem de erro (nota inexistente etc.) |

Observações:
- Números no formato BR (`1.234,56`). O parser deve remover rótulos (`Qtde.:`, `UN:`,
  `Vl. Unit.:`), trocar `.` por nada e `,` por `.`.
- Em homologação [V], o erro aparece via script:
  `$('#spnErroProsseguirMaster').html('<ul><li>…</li></ul>')`. Trate também esse padrão.
- Ao colar o texto renderizado pelo Safari (Camada 1), as classes somem. O parser de texto
  deve se apoiar nos rótulos acima, que aparecem visíveis na página.

## 8. Reprodução

Scripts e respostas brutas desta sessão ficaram no scratchpad do agente, que é temporário.
Para repetir, use os comandos das seções 3.1 a 3.4 com
`UA_IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'`.
