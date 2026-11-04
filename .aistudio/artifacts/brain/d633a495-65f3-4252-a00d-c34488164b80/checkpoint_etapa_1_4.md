# Checkpoint Local — Etapa 1.4: Correção de Integridade das Mensagens Privadas

**Data do Registro:** 03/11/2026  
**Status da Etapa:** Concluído com sucesso (Aguardando revisão)  
**Arquivo Modificado Exclusivo:** `/firestore.rules`  
**Deploy Realizado:** Nenhum (conforme restrição)  

---

## 1. Resumo das Alterações Aplicadas

Foram implementadas três correções estruturais de integridade em `/firestore.rules`:

1. **Prevenção de Falsificação de `senderName`:**
   - Adicionada asserção `getAfter(...).data.senderName == incoming().lastMessage.senderName` tanto na criação da primeira mensagem (Caso B) quanto em mensagens subsequentes (Operação 1).
   - Impede que remetentes forjem identidades ou nomes arbitrários no snippet exibido nas caixas de entrada dos destinatários.

2. **Prevenção de Falsificação do Estado de Leitura (`isRead`):**
   - Adicionada exigência `incoming().lastMessage.isRead == false` no momento do envio.
   - Adicionada asserção `getAfter(...).data.isRead == incoming().lastMessage.isRead`.
   - Garante que toda nova mensagem seja invariavelmente não lida e impede que remetentes marquem falsamente como lida a mensagem antes da visualização pelo destinatário.

3. **Garantia de Correspondência de Identidade do Documento (`msgId`):**
   - Adicionada asserção `incoming().id == msgId` na regra `allow create` da subcoleção `/conversations/{convId}/messages/{msgId}`.
   - Garante a sincronia exata entre o identificador do documento na rota e a chave `id` dentro do payload JSON da mensagem.

---

## 2. Testes e Validação Semântica

- **Inspeção Estática:** Validados todos os caminhos condicionais e fluxos de curto-circuito lógico do Firestore Rules v2.
- **Testes Automatizados (Node/TypeScript):** 20/20 testes de mensagens privadas e 20/20 testes de segurança passaram com sucesso.
- **Build / Compilação:** `compile_applet` executou com sucesso (código íntegro e sem erros).
- **Limitação de Ambiente:** O Firebase Emulator Suite nativo permanece indisponível no contêiner devido à ausência do Java Runtime Environment (`java: not found`).
