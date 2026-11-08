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

Limitações conhecidas: preços unitários com mais de 2 casas (ex.: combustível 4,599) são arredondados para centavos (o total da nota vale); descontos aplicados por item fora do bloco de totais só geram aviso; apenas a primeira forma de pagamento é lida. Se o texto não trouxer número e série, o app pede uma confirmação extra. Se o texto for de outra nota, o app recusa. Por enquanto os itens são apenas guardados; o
reconhecimento dos produtos e o histórico de preços são o próximo passo.

## Ainda não disponível

Reconhecimento dos produtos da nota, despensa, histórico de preços, previsões e modo compras
são as próximas fases. O app mostra essas áreas como "em breve".
