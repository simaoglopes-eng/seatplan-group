# Expansão SeatPlan — âmbito confirmado por Martim

Este pedido inclui todas as funcionalidades abaixo. A entrega anterior das avaliações
e dos mapas não concluiu este âmbito. Cada linha deve ser entregue com API, interface,
migração quando necessária e validação. Não apresentar adaptadores ou simulações
como integrações de produção.

| Funcionalidade | Estado nesta entrega | Critério de conclusão / dependências |
| --- | --- | --- |
| As minhas reservas | Implementado e validado | Histórico paginado, associação apenas por email provado, favoritos, cancelar e reservar novamente. Registo independente de eventos ainda por fazer. |
| WhatsApp / SMS | Pendente | Consentimento por canal, outbox idempotente, lembretes, resposta confirmar/cancelar, webhooks autenticados, fornecedor e credenciais reais. |
| Garantia / depósito | Pendente | Checkout alojado, política explícita, webhook assinado, cancelamento/reembolso, estados; requer conta de pagamentos. Nunca guardar dados de cartão. |
| PT / EN / ES / FR | Pendente | Seleção persistente, interface pública, conta, reserva, mensagens e datas localizadas. |
| Menu e preços | Implementado | Edição pelo dono, categorias, preço em cêntimos, moeda e publicação pública. |
| Ocasião e alimentação | Implementado | Campos próprios no formulário, reserva, gestão e sala. Alergias distinguem-se de preferências e exigem confirmação pelo restaurante. |
| Distribuição | Pendente | Widget incorporável, código de instalação e link Instagram; Google depende de parceiro e contrato, não simular ativação. |
| Ficha de cliente | Histórico implementado | Acesso exclusivo do staff do restaurante, visitas concluídas, notas, histórico e política de privacidade. |
| Meteorologia no sol | Pendente | Previsão horária Open-Meteo, timezone do restaurante, limite da previsão e falhas; manter astronomia separada de nebulosidade. |
| Plano de chuva | Pendente | Proposta interior comparável, aceite explícito, disponibilidade revalidada; nunca mudar a mesa silenciosamente. |
| Pôr do sol | Pendente | Dia/hora e mesa sugeridas usando astronomia e orientação real; verificar disponibilidade. |
| Aviso por mesa | Pendente | Mesa/data/período, consentimento, expiração, aviso idempotente quando disponível; aviso não equivale a reserva. |
| Avaliações por mesa | Pendente | Associação verificável a reserva/mesa, retenção de histórico de mesas após libertar slots, agregação por ocasião, repetir mesa sujeito a disponibilidade. |
| Vou atrasado | Implementado | Link da reserva, previsão de chegada, limites de estado, atualização ao vivo da sala. |
| Mapa de calor | Pendente | Métricas por mesa e período, denominadores explícitos, uso e procura separados. |
| Pesquisa natural | Pendente | Extrair critérios editáveis PT/EN/ES/FR e mostrar a interpretação; orçamento exige preço real, não inferir de price_level. |
| Acessibilidade / ruído | Pendente | Zona Quiet já existe; acrescentar informação de percurso sem degraus validada pelo dono. Não prometer silêncio ou acessibilidade sem dados. |
| Vales-oferta | Pendente | Valor/experiência, compra, código seguro, saldo e resgate atómico, expiração e reembolso; pagamento real depende do fornecedor. |

## Ordem de implementação

1. Conta, histórico, favoritos e nova reserva.
2. Dados estruturados da reserva, atraso, ficheiro de cliente e histórico das mesas.
3. Menu, acessibilidade e tradução dos percursos públicos.
4. Meteorologia, pôr do sol, alertas por mesa e proposta de chuva.
5. Avaliações por mesa, métricas e pesquisa em linguagem natural.
6. Widget, canais de comunicação, pagamento e vales, com configurações documentadas.

## Estado da integração

O checkout gravável está em `tmp/seatplan-work`, branch `codex/finish-restaurants`.
O checkout ativo `C:/Users/marti/seatplan-rux` não permite escrita nesta sessão.
A publicação GitHub falhou anteriormente por falta de resolução de rede. É obrigatório
distinguir código local, bundle de transporte e alterações efetivamente publicadas.



