# Transferência da expansão SeatPlan

Estado: primeira entrega parcial do âmbito pedido, com quatro commits de implementação
na branch `codex/finish-restaurants`. A lista integral e os estados estão em
`docs/superpowers/plans/2026-11-17-expansao-restaurantes.md`.

## Integrar no checkout de Martim

Comando recomendado no PowerShell de Martim:

```powershell
& "$env:USERPROFILE/Documents/ChatGPT/Tese/tmp/seatplan-work/scripts/Integrate-RestaurantExpansion.ps1"
```

O script verifica a branch e alterações locais, valida o bundle, cria um backup
consistente do SQLite, integra apenas por fast-forward, migra a base local e
compila o frontend. Não altera WhatsApp, SMS ou pagamentos, nem faz push.
Recusa bases remotas e não descarta alterações locais. Se faltar acesso ao
checkout nesta sessão, tem de ser executado pelo utilizador no seu terminal.

Se parar por haver alterações locais, usar a opção de preservação:

```powershell
& "$env:USERPROFILE/Documents/ChatGPT/Tese/tmp/seatplan-work/scripts/Integrate-RestaurantExpansion.ps1" -PreserveLocalChanges
```

Esta opção guarda ficheiros modificados e novos num stash, integra os commits e
repõe os ficheiros e o estado de staging antes da migração e do build. O stash
não é apagado. Se houver conflitos, o script para sem migrar; guardar o hash
impresso e enviar `git status --short` para rever. Não repetir o stash apply nem
apagar o stash enquanto houver conflitos. A base SQLite tem backup separado.

O bundle `C:/Users/marti/Documents/ChatGPT/Tese/SeatPlan_Expansao.bundle` contém
as alterações a partir de `035c530`. O checkout ativo foi confirmado nesse commit.
A sessão não tem autorização de escrita nessa pasta. O push direto falhou com
`getaddrinfo() thread failed to start`.

No PowerShell fora desta sessão:

```powershell
Set-Location "$env:USERPROFILE/seatplan-rux"
git status --short
# Se houver alterações locais, guarda-as antes de continuar. Não as descartes.
git fetch "$env:USERPROFILE/Documents/ChatGPT/Tese/SeatPlan_Expansao.bundle" codex/finish-restaurants
git merge --ff-only FETCH_HEAD
Set-Location backend
& "$env:USERPROFILE/seatplan/.venv/Scripts/python.exe" -m app.seed.migrate
# Reinicia o backend se não estiver em modo --reload.
Set-Location ..
git push origin HEAD:refs/heads/codex/finish-restaurants
```

Se o merge recusar, parar e resolver a divergência; não usar reset --hard nem force push.

## Prompt para Sérgio após o push

> Atualiza a tua branch de trabalho com `origin/codex/finish-restaurants`.
> Faz primeiro `git status` e preserva alterações locais. Faz fetch e integra a branch,
> sem force push. As alterações incluem: histórico de reservas privado com associação
> apenas por email provado, favoritos e nova reserva; ocasião, preferências alimentares
> e alergias; previsão de chegada via link de gestão com atualização da sala; histórico
> de visitas para staff limitado ao restaurante; editor de menu e preços EUR com
> proteção de versão e aba pública Menu.
> Executa `python -m app.seed.migrate` no backend, usando o ambiente do projeto.
> Consulta `docs/superpowers/plans/2026-11-17-expansao-restaurantes.md` para o âmbito
> restante. WhatsApp/SMS, pagamentos, traduções, meteorologia, avisos por mesa,
> avaliações por mesa, mapa de calor, widget, pesquisa natural, percursos acessíveis
> e vales NÃO estão concluídos. Não apresentar essas funcionalidades como prontas.
> Preserva os caminhos de eventos indicados em AGENTS.md e valida a tua integração.

## Validação desta entrega

- Backend: novos testes de privacidade, autorização, reservas, ETA, menus e migrações;
  regressões de reviews, contas e staff passaram.
- Frontend: suite de 571 testes passou após a reserva/ETA; os 127 testes de restaurante
  passaram após a ficha do cliente; 44 testes de owner/página pública passaram após
  o menu. Typecheck, build, Ruff e proteção dos caminhos de eventos passaram.
- Chromium com backend FastAPI e base descartável: login/favoritos, campos de reserva,
  persistência de ETA, sala, histórico e edição/publicação de menu com preços passaram.
- Suite completa backend e execução Playwright normal por servidores locais não
  foram concluídas nesta entrega; a restrição de sockets exigiu a ponte de teste.
