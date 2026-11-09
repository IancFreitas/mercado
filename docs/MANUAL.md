# Manual do Smart Pantry

App: **https://iancfreitas.github.io/mercado/**

Não existe "cadastro" separado. Para usar sozinho, você não precisa de conta. Para
compartilhar a lista com outra pessoa, o app pede só o seu e-mail e envia um código;
a conta é criada nesse momento.

---

## Parte A — Uma vez só, pelo Ian (responsável pelo servidor)

Sem isto, o e-mail de login chega só com um link (que abre fora do app) e o login não funciona.

1. Entre em https://supabase.com/dashboard e abra o projeto **smart-pantry**.
2. Menu **Authentication › Emails** (ou *Email Templates*).
3. Abra o template **Magic Link**. No corpo, adicione numa linha:
   `Seu código do Smart Pantry: <h2>{{ .Token }}</h2>`
   e clique em **Save**.
4. Faça o mesmo no template **Confirm signup**.
5. Menu **Authentication › URL Configuration** › **Site URL**:
   `https://iancfreitas.github.io/mercado/` › **Save**.

Pronto. Não há cobrança: o projeto está no plano gratuito.

---

## Parte B — Instalar no iPhone (cada pessoa, no próprio aparelho)

1. Abra o link do app no **Safari** (não funciona instalar pelo Chrome).
2. Toque em **Compartilhar** (quadrado com seta) › **Adicionar à Tela de Início** › **Adicionar**.
3. Daqui em diante, abra **sempre pelo ícone "Despensa"**. O Safari e o app instalado
   guardam dados separados.

## Parte C — Começar

**Ian (cria a Casa):**
1. Abra o app › **Criar minha Casa** › seu nome e o nome da Casa › **Começar**.
2. A lista já funciona, inclusive sem internet. O selo no topo mostra "Só neste aparelho".

**Ativar o compartilhamento (Ian):**
1. Aba **Casa** › **Compartilhamento** › digite seu e-mail › **Enviar código**.
2. Abra o e-mail, copie o código de 6 dígitos, cole no app › **Confirmar código**.
3. Toque em **Ativar compartilhamento desta Casa**. O selo muda para "Sincronizado".
4. Toque em **Gerar código de convite** e mande o código para a Fernanda por mensagem.
   Ele vale por 48 horas e só pode ser usado uma vez.

**Fernanda (entra na Casa):**
1. Instale o app (Parte B) › **Entrar com um convite**.
2. Digite o e-mail › código recebido por e-mail › **Confirmar código**.
3. Digite seu nome e o **código de convite** do Ian › **Entrar na Casa**.

## Parte D — Uso do dia a dia

- **Adicionar:** aba **Lista**, digite o item e toque em **+**. Em **Mais** você escolhe
  quantidade, unidade e categoria. Se o item já está na lista, a quantidade é somada.
- **Comprou:** toque no círculo do item; ele vai para "No carrinho". **Limpar** tira os comprados.
- **Editar/remover:** toque no nome do item. Removeu sem querer? "Ver removidos recentemente" › **Restaurar**.
- **Sem internet:** use normalmente. As alterações aparecem como "pendentes" e sobem sozinhas
  quando a internet voltar e o app estiver aberto.
- **Mudou ao mesmo tempo que a outra pessoa:** o app fica com a alteração mais recente e avisa.
  Em **Casa › Conflitos** você pode voltar para a outra versão.
- **Item duplicado** (os dois adicionaram offline): aparece o aviso com o botão **Unir**.
- **Atualizar:** o app sincroniza ao abrir, ao voltar para ele e a cada 20 s com ele aberto.
  O iPhone não deixa sincronizar com o app fechado.

## Parte E — Backup e troca de celular

- **Casa › Backup › Exportar backup** › salvar em **Arquivos › iCloud Drive**.
- Celular novo: instale o app › **Restaurar de um backup…**. Ou, se o compartilhamento
  estiver ativo, basta entrar com o mesmo e-mail e um novo convite.

## Parte F — Atalho da Siri (opcional)

No app **Atalhos**: novo atalho › ação **Abrir URLs** com
`https://iancfreitas.github.io/mercado/#/lista?add=leite` › nomeie "Adicionar leite".
Diga "E aí Siri, adicionar leite". O app abre e pede confirmação antes de gravar.
(Pode abrir no Safari em vez do app instalado — limitação do iOS a confirmar no teste.)

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| E-mail chegou só com link, sem código | Falta a Parte A |
| "Convite inválido" | Código expirou (48 h), já foi usado ou quem gerou saiu da Casa — gere outro |
| Selo "Sem acesso à Casa" | Você foi removido da Casa |
| App parou de sincronizar depois de dias sem uso | O Supabase gratuito pausa após ~7 dias; Ian abre o painel e clica em **Restore** |
| Dados sumiram ao abrir pelo Safari | Abra pelo ícone da Tela de Início |

## Parte G — Notas fiscais (início da Fase 2)

1. Tela **Início** › **Escanear NFC-e**.
2. Escolha: **Escanear com a câmera** (aponte para o QR do cupom), **Ler QR de uma foto**
   (foto já tirada) ou digite a **chave de acesso** (44 números abaixo do QR).
3. Confira loja (CNPJ), mês, número e, em notas emitidas offline, o valor total › **Registrar nota**.
4. Se a mesma nota já foi registrada (por você ou pela Fernanda), o app avisa e não duplica.
5. **Abrir na SEFAZ** mostra a nota completa no site oficial.

Depois de registrada, a nota fica com "itens pendentes". Para importar os produtos e preços:

6. Toque em **Abrir na SEFAZ** (ou **SEFAZ** na lista) e aguarde a nota completa aparecer.
7. Na página da nota, toque e segure em qualquer texto › **Selecionar Tudo** › **Copiar**. Não
   é preciso escolher trecho nenhum: o app lê só os produtos e totais e ignora tudo a partir de
   "Chave de acesso" (CPF, nome e endereço do consumidor não são lidos nem salvos). Obs.: por bloqueio da
   SEFAZ a servidores, a importação automática não é possível; o caminho é o Selecionar Tudo.
8. Volte ao app, em **Notas registradas** toque em **Importar itens**, toque em **Colar** (ou cole
   no campo "Texto da nota") e em **Ler texto**.
9. Confira a prévia: itens, quantidades, valor a pagar e forma de pagamento. Se aparecer um
   aviso (por exemplo, a soma dos itens não bate com o total), provavelmente faltou algum
   item na cópia: cancele e copie de novo. Estando certo, toque em **Confirmar importação**.
10. A nota passa a "importada"; toque em **Ver itens** para listar o que foi comprado.
    Se Ian e Fernanda importarem o mesmo texto, os itens não duplicam.

Limitações conhecidas: preços unitários com mais de 2 casas (ex.: combustível 4,599) são arredondados para centavos (o total da nota vale); descontos aplicados por item fora do bloco de totais só geram aviso; apenas a primeira forma de pagamento é lida. Se o texto não trouxer número e série, o app pede uma confirmação extra. Se o texto for de outra nota, o app recusa. Os itens importados alimentam os preços da lista
(veja "Preços na lista" abaixo); os produtos também podem ir para a Despensa (veja abaixo).

## Preços na lista

Cada item da lista de compras que combina com algum produto de uma nota **importada** mostra, abaixo do nome,
uma linha como "Último R$ 12,90 · 19/09 · médio R$ 12,50 · FITA CREPE BRANCA 48MMx50M" (o final é o produto da nota associado, para você conferir) (o médio aparece com 2 ou mais compras).
Toque no item para ver "Preços pagos": até 5 compras com data, preço unitário, descrição na nota e CNPJ da loja.

Como funciona: o app compara as palavras do nome do item com a descrição da nota, ignorando acentos e
maiúsculas; abreviações comuns de nota fiscal funcionam ("Sabão líquido" encontra "SAB ... LQD"). Todas as
palavras do nome (3+ letras) precisam aparecer, e números/medidas devem bater ("Tinta 20l" não encontra tinta de 18L).
Nomes muito curtos (menos de 3 letras) não encontram nada. Só entram notas já importadas e da sua Casa;
notas pendentes ou removidas são ignoradas. Nada é enviado ou alterado: é apenas leitura.

Limitações: embalagens diferentes (ex.: 900 ml e 3 L) ainda não são comparadas; preço médio e mínimo
só consideram compras na mesma unidade da última. Associações podem errar quando o nome é genérico
(ex.: "Fita" também encontra fita isolante; "Leite" pode encontrar leite condensado ou creme de leite; "Pão", "Tomate" e "Sal" também): confira o produto mostrado na linha e use um nome mais específico. Abreviações muito cortadas (ex.: "QJO" para queijo) não são reconhecidas.

## Despensa

A aba **Despensa** mostra o que há em casa, por categoria, com a quantidade e a data da última compra.

- **Como entra:** ao importar os itens de uma nota, deixe marcado **Adicionar à despensa** (já vem marcado). Para uma nota
  importada antes, use **Adicionar à despensa** na linha da nota (em **Notas**); repetir o toque ou fazer nos dois celulares
  não duplica nada. Também dá para **Adicionar produto** à mão (nome, quantidade, unidade, categoria).
- **Nome e categoria:** o nome vem da descrição da nota em letras de título (ex.: "Arroz Tipo 1 5KG") e a categoria começa
  em "Outros". Toque em **Editar** para mudar nome, categoria ou a quantidade.
- **Usei 1** diminui 1 do estoque. **Acabou** zera. **Ainda tem** só anota que você conferiu (não muda a quantidade).
  Em **Editar**, mudar a quantidade registra um *ajuste*, e **Descartar 1** registra um descarte.
- **Acabou:** produtos sem estoque vão para a seção "Acabou", com **Pôr na lista** (não duplica se já estiver na lista).
- **Histórico:** toque no nome do produto para ver todas as movimentações (compra, consumo, ajuste...) com data e quem fez.
- A quantidade é sempre a **soma das movimentações**, então se vocês dois registrarem "Usei 1" ao mesmo tempo (até offline),
  as duas baixas valem. Quantidades fracionadas (kg) usam até 3 casas.
- Limitações: se uma nota for removida depois, o estoque que ela gerou continua (ajuste na mão); itens de uma nota cuja unidade
  difere da do produto (ex.: kg × un) não são somados e a mensagem avisa; nota sem itens importados não entra na despensa.

## Gastos

**Início › Gastos do mês** (ou `#/gastos`) mostra, para o mês escolhido (padrão: o atual, no horário de São Paulo):
o total gasto, a comparação com o mês anterior (só quando os dois meses têm gastos), o total por **loja** (CNPJ),
por **categoria** e a lista das compras. Entram as compras da Casa não removidas com valor maior que zero (notas importadas
usam o *valor a pagar*; notas escaneadas offline, o valor do QR). Na divisão por categoria somam-se os **itens**, pela categoria
do produto na Despensa; itens sem produto ficam em "Sem categoria", e descontos/acréscimos da nota não entram nessa divisão,
por isso a soma das categorias pode diferir do total do mês.

## Ainda não disponível

Previsões de reposição, histórico de preços completo e modo compras são as próximas fases. O app mostra essas áreas como "em breve".
