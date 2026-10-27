# Encaixar o agendamento do Vórtex Call em outra página

Você pode mostrar os horários da agenda dentro de qualquer página sua (site, landing page, formulário), sem mandar a
pessoa pra outro endereço. Basta colar uma linha onde o módulo deve aparecer (troque `seu-dominio.com.br` pelo
endereço do seu Vórtex Call e `diagnostico` pelo endereço da agenda, o campo "Endereço" no editor da agenda):

```html
<script src="https://seu-dominio.com.br/agendar.js" data-agenda="diagnostico"></script>
```

Atributos opcionais (preenchem o lead e pulam a pergunta de nome e WhatsApp):

| Atributo | O quê |
|---|---|
| `data-nome`, `data-whatsapp`, `data-email` | Dados do lead |
| `data-resposta` | Id da resposta no seu formulário (guardado na inscrição, pra você cruzar depois) |
| `data-alvo` | Seletor CSS de onde pôr o módulo (padrão: logo depois do script) |

As UTMs da página (`utm_source` etc.) vão junto sozinhas.

Quando o lead agenda, a página recebe o evento:

```js
window.addEventListener("vortex-call:agendado", (e) => {
  // e.detail = { sessao, resultado: "nova" | "mesma" | "reagendada", inicio, codigo?, link? }
  // codigo e link só vêm quando resultado é "nova": em "mesma" e "reagendada" o lead já recebe
  // o link pelo WhatsApp e não é exposto aqui.
});
```

## Janela de agendamento

Cada agenda pode limitar quantos dias o lead enxerga: campo "Mostrar os próximos ___ dias com horário" no editor
da agenda (`agendas.janela_dias`, 1 a 60; vazio = todos). Contam só os dias (no calendário de Brasília, a partir de
hoje) que ainda têm horário com vaga; fim de semana sem sessão não gasta dia. Com 2: sexta 15h mostra o resto de
sexta e a segunda; sábado mostra segunda e terça. Vale igualmente na página `/agendar/{agenda}`, no módulo encaixado e
no "Escolher outro horário" do link pessoal (`GET /api/agendamento/{agenda}` já vem cortado). A rota de inscrever
confere de novo no servidor: sessão fora da janela volta 409 `{ resultado: "fora_da_janela", erro: "Esse horário
ainda não está aberto pra agendamento." }` (o módulo mostra a mensagem e recarrega os horários). Regra pura em
`src/lib/regras/janela.ts` (`filtrarJanela`). A listagem da API v1/MCP e a criação de sessões no painel não mudam.

## Dentro de um formulário ou chat de captura

Se você usa um formulário próprio (ou uma página em formato de conversa) e quer que o último passo seja "escolha o
horário", insira o script acima com `data-agenda` e os dados que a pessoa já respondeu (`data-nome`,
`data-whatsapp`, `data-email`, `data-resposta`) e, ao receber `vortex-call:agendado`, siga para o próximo passo.

Se o Vórtex Call estiver fora do ar, o módulo vira um link para `https://seu-dominio.com.br/agendar/<agenda>` depois
de 8 segundos; o seu formulário continua funcionando.

## Página de teste (`/teste-encaixe.html`)

`public/teste-encaixe.html` simula uma página de fora embutindo o script do encaixe (com a agenda `vendas`; troque
pelo endereço de uma agenda sua). Ela não é pública: exige login no painel, como o resto do `/`. Pra testar, entre
logado no seu domínio e abra `/teste-encaixe.html`.
