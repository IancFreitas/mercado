## Equipe de agentes (obrigatório)

Todo trabalho feito neste projeto passa por uma equipe de subagentes, definidos em `.claude/agents/` (do projeto ou de `~/.claude/agents/`). Há quatro cargos, e a orquestradora **escala quantas instâncias de cada cargo a tarefa pedir**:

| Papel   | Agente    | Modelo | Custo | Faz o quê |
|---------|-----------|--------|-------|-----------|
| Júnior  | `junior`  | haiku  | baixo | Trabalho braçal: levantar arquivos/dados, mudanças mecânicas, rodar comandos e testes, rascunhos |
| Pleno   | `pleno`   | sonnet | médio | Implementa a parte principal de uma frente e revisa os Júniores dela |
| Sênior  | `senior`  | sonnet | médio | Partes difíceis, revisão adversarial de uma frente/área de risco, consolida a discussão |
| Gerente | `gerente` | opus   | alto  | Decide: `APROVADO` ou `REFAZER` (e quem refaz) |

A sessão principal é a **orquestradora**: ela divide o trabalho em **frentes** (pedaços independentes, cada um com seus arquivos), repassa as entregas de um para o outro e só fala com o usuário depois da decisão do Gerente. Subagentes não chamam outros subagentes: quem faz a ponte é sempre a sessão principal. Os subagentes editam direto na árvore de trabalho.

**Antes de dividir qualquer tarefa que mude arquivos ou faça ação externa, carregue a skill `equipe`** (`.claude/skills/equipe/SKILL.md`, ou `~/.claude/skills/equipe/`): dimensionamento, fluxo de 6 passos, discussão e réplica, decisão, refazer, entrega, modelos de prompt e checklist. Se a skill não puder ser carregada, siga este núcleo: Júnior/Pleno executam por frente, em arquivos disjuntos listados no prompt; o Sênior revisa antes do Gerente, com a transcrição completa das entregas colada no prompt; integração e validação final só por Pleno ou Sênior, nunca Júnior; o Gerente decide `DECISÃO: APROVADO` ou `DECISÃO: REFAZER` (um Gerente por decisão); no máximo 3 rodadas; só depois de `APROVADO` o trabalho é dado por concluído (commit, push, PR e merge: ver "Autonomia e economia").

Se o projeto tiver uma seção própria (ex.: "A equipe neste projeto"), ela prevalece sobre os números, as atribuições e a profundidade da revisão padrão (quantas instâncias, quem faz o quê, um Sênior e um Gerente por rodada em vez de por frente etc.); a ordem do fluxo e as regras de segurança continuam valendo. Ela só pode **dispensar** o Sênior e o Gerente em exceções nomeadas explicitamente, limitadas a: (a) a execução em si de rotinas automáticas sem humano (rotinas agendadas), nunca a edição da rotina ou do código dela, e descrevendo as travas que substituem a revisão (e anotando "sem equipe" onde o projeto mantiver diário ou registro); (b) leitura pura ou registro mecânico de log, sem efeito externo. Fora disso, Sênior e Gerente nunca são pulados. Cargo no singular na seção do projeto ("o Pleno", "o Júnior") não limita o número de instâncias, salvo se ela disser um número.

**Proporcionalidade:** perguntas simples de informação (sem mudança em arquivo nem ação externa) podem ser respondidas direto, sem acionar a equipe. Tarefas pequenas podem usar uma instância só de cada cargo, ou pular o Júnior ou o Pleno, mas **nunca** pulam o Sênior e o Gerente quando há mudança em código, arquivos ou ações externas, salvo as exceções nomeadas na seção do projeto.

**Autonomia e economia (preferência permanente do usuário):** (a) melhoria ou adicional necessário ou claramente importante, dentro do objetivo do pedido, é feito sem pedir aprovação, passa por Sênior e Gerente e é relatado na resposta. (b) Após `APROVADO`, commit, push, PR e merge do trabalho pedido são feitos sem perguntar (sem force push nem reescrita de histórico). (c) Continuam exigindo pedido explícito: ação destrutiva ou irreversível, gasto de dinheiro, envio a terceiros, publicação (inclusive push ou merge que dispara deploy/Pages) e uso ou gravação de credenciais. (d) Regra do projeto (aprovação do dono, proibição de nome de modelo em commit etc.) prevalece sobre (a) e (b). (e) Economize tokens sem perder qualidade: menos instâncias quando der, prompts curtos, ler só o necessário, transcrição longa em arquivo referenciado, sem repetir trabalho.

<!-- fim-equipe -->
