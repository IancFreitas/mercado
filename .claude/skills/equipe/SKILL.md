---
name: equipe
description: Procedimento detalhado da equipe de agentes (Júnior, Pleno, Sênior, Gerente) e da orquestradora. Carregue ANTES de dividir qualquer tarefa que mude arquivos (código, docs, config) ou faça ação externa (envio, publicação, push, gravação em banco ou serviço). Não carregue para perguntas só de informação. Traz dimensionamento, fluxo de 6 passos, discussão, réplica, decisão do Gerente, refazer, entrega, modelos de prompt e checklist da orquestradora.
---

# Equipe de agentes: procedimento da orquestradora

O núcleo obrigatório (cargos, precedência, exceções nomeadas, Sênior e Gerente nunca pulados) está no `CLAUDE.md`. Aqui está o passo a passo. Se o `CLAUDE.md` do projeto isenta a execução em curso (por exemplo, rotina agendada sem humano), não aplique este procedimento a ela; vale o que a seção do projeto descreve. A seção própria do projeto ("A equipe neste projeto") prevalece sobre números, atribuições e profundidade de revisão; a ordem do fluxo e as regras de segurança continuam valendo.

## Dimensionamento

- **Frente** = pedaço independente da tarefa, com seu próprio conjunto de arquivos. A orquestradora define as frentes e, para cada uma, quantas instâncias de cada cargo (ex.: 1 Pleno + 3 Júniores; 1 Sênior por área de risco).
- **Critério:** volume decide quantos Júniores e Plenos (muitos arquivos ou itens repetitivos → mais instâncias, cada uma com uma fatia); risco decide Sêniores (segurança, dados, arquitetura, ação externa → um Sênior por área de risco).
- **Custo proporcional:** o Júnior é barato, então use em massa no braçal (varrer, renomear, rodar testes por módulo). Não gaste Pleno ou Sênior no que um Júnior resolve. O Gerente é caro: só decide, não implementa.
- **Teto sensato:** até cerca de 8 instâncias simultâneas, e só quando houver trabalho de fato independente; mais instâncias que frentes reais só geram conflito e custo. Passou disso, rode em lotes.
- **Paralelismo só em arquivos disjuntos:** cada instância recebe, no prompt, o conjunto exato de arquivos que pode tocar e não mexe no resto. Se duas frentes precisam do mesmo arquivo, rodam em sequência ou um Pleno designado integra. Quem integra (juntar frentes, resolver conflito, rodar a validação final) é um Pleno ou Sênior, nunca um Júnior.
- Os subagentes editam direto na árvore de trabalho; um `REFAZER` parte do estado atual.

## Fluxo de cada tarefa

1. **Divisão** — a orquestradora quebra o pedido em frentes, dimensiona e atribui: braçal → Júnior(es), implementação → Pleno(s), arquitetura/riscos → Sênior(es). Frentes independentes rodam em paralelo.
2. **Execução** — cada instância entrega no formato do seu arquivo de agente, dizendo qual frente/arquivos cobriu.
3. **Discussão** — antes de ir ao Gerente, a equipe discute, por frente:
   - cada Pleno recebe a entrega dos Júniores da sua frente e responde (concorda, corrige, discorda);
   - o Sênior da frente/área recebe as entregas e a resposta do Pleno, faz a revisão adversarial e consolida uma proposta, registrando divergências em aberto. Com vários Sêniores, um deles (ou a orquestradora) junta os pareceres numa proposta única;
   - se o Sênior discordar de algo, a orquestradora devolve **só ao Pleno daquela frente** uma vez para réplica (use `SendMessage` para continuar o mesmo agente; sem `SendMessage`, reinvoque colando o contexto anterior);
   - a orquestradora sempre cola a transcrição completa (entregas + réplicas) no prompt do próximo membro, e não um resumo dela.
4. **Decisão** — o Gerente recebe o pedido original do usuário + todas as entregas + a discussão e responde `DECISÃO: APROVADO` ou `DECISÃO: REFAZER`. Há **um Gerente por decisão**:
   - frentes independentes (arquivos e critérios próprios, sem dependência entre si) podem ter um Gerente cada, em paralelo;
   - frentes acopladas, ou quando a coerência do conjunto importa, passam por um só Gerente para tudo.
   Se ele pedir esclarecimento, a orquestradora consulta o membro e reapresenta.
5. **Refazer** — se `REFAZER`, a orquestradora devolve o trabalho a quem o Gerente indicou (a instância e a frente), com o critério de aceite dele, e repete os passos 3–4 só para o que foi reprovado. Limite de **3 rodadas** por decisão; se ainda não aprovar, leva ao usuário o impasse e as opções.
6. **Entrega** — só depois de `APROVADO` (de todos os Gerentes envolvidos) a orquestradora dá o trabalho por concluído (commit/push/PR só se o usuário pediu) e responde ao usuário, citando de forma curta o que cada frente/cargo fez e a decisão do Gerente.

## Proporcionalidade

- Perguntas simples de informação (sem mudança em arquivo nem ação externa) podem ser respondidas direto, sem acionar a equipe.
- Tarefas pequenas podem usar uma instância só de cada cargo, ou pular o Júnior ou o Pleno, mas **nunca** pulam o Sênior e o Gerente quando há mudança em código, arquivos ou ações externas, salvo as exceções nomeadas na seção do projeto.

## Modelos de prompt (um por instância)

Todo prompt traz: o pedido original do usuário (literal), a frente, a lista exata de arquivos que a instância pode tocar (e a ordem de não mexer no resto), o que não pode ser feito (ações externas, dados reais, credenciais, regras do projeto) e o formato de entrega do arquivo do agente.

- **Júnior:** "Frente X. Pedido: <literal>. Você pode tocar só: <arquivos>. Faça: <tarefa mecânica e delimitada>. Rode: <comandos> e cole a saída real. Não amplie o escopo; diga o que não tiver certeza."
- **Pleno:** "Frente X. Pedido: <literal>. Você pode tocar só: <arquivos>. Implemente: <parte central>. Abaixo a entrega dos Júniores da sua frente (transcrição completa): <...>. Revise: diga o que aproveitou e corrigiu. Valide rodando <comandos>."
- **Sênior (revisão):** "Área de risco: <área>. Pedido: <literal>. Abaixo as entregas e a resposta do Pleno (transcrição completa): <...>. Faça revisão adversarial com caminho concreto de falha, consolide uma proposta e registre divergências em aberto. Não edite, salvo se o prompt disser."
- **Pleno (réplica):** "O Sênior discordou de: <pontos, transcrição completa do parecer>. Responda ponto a ponto: concorde, discorde com motivo concreto ou proponha meio-termo. Só uma réplica."
- **Gerente:** "Pedido original do usuário: <literal>. Abaixo todas as entregas, o parecer do Sênior e as réplicas (transcrição completa): <...>. Decida `DECISÃO: APROVADO` ou `DECISÃO: REFAZER` e, se REFAZER, quem refaz e o critério de aceite. Ação externa ou irreversível só se o usuário já pediu."

## Checklist da orquestradora

- Dividi em frentes e defini quantas instâncias de cada cargo (volume → Júniores/Plenos; risco → Sêniores).
- Cada prompt tem a lista exata de arquivos que a instância pode tocar; nenhum arquivo aparece em duas frentes paralelas (senão, sequência ou um Pleno integra).
- Integração e validação final foram de Pleno ou Sênior, nunca de Júnior.
- Colei a transcrição completa (entregas + réplicas) no prompt do próximo membro, não um resumo.
- Sênior revisou antes do Gerente; divergência dele foi para o Pleno da frente uma vez só.
- O Gerente recebeu o pedido literal do usuário; um Gerente por decisão (independentes: um cada; acopladas: um só).
- Só tratei como concluído após `APROVADO` de todos os Gerentes; no `REFAZER`, devolvi à instância indicada com o critério de aceite, no máximo 3 rodadas por decisão.
- Commit, push e PR só se o usuário pediu (ou a seção do projeto autoriza de forma permanente).
- Resposta final ao usuário: curta, o que cada frente/cargo fez e a decisão do Gerente; o que não foi executado, dito como "não executado".
