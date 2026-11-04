# Mensagens privadas temporariamente desativadas — Hikari Perfil

As mensagens privadas foram ocultadas/desativadas na interface do site por meio da flag:

`src/config/features.ts`

Atualmente:

```ts
export const ENABLE_PRIVATE_MESSAGES = false;
```

## O que esta alteração faz

- Oculta o botão de mensagens no cabeçalho.
- Oculta o botão de mensagem nos perfis.
- Oculta as preferências de mensagens privadas e presença no chat nas configurações.
- Impede a abertura do modal de mensagens pela interface.
- Desativa a assinatura de contagem de mensagens não lidas e a sincronização de contexto de privacidade do chat enquanto o recurso estiver desligado.
- Mantém os componentes, serviços, rotas, tipos, testes, regras Firestore e dados existentes no projeto para uma possível reativação futura.

## Como reativar futuramente

Depois que o chat for corrigido e testado com duas contas reais, altere somente o valor em `src/config/features.ts` para `true`, revise o restante da integração e faça os testes antes de publicar.

## Importante

- Nenhuma conversa ou mensagem foi apagada do Firestore.
- Nenhuma regra de segurança foi publicada ou alterada nesta etapa.
- Nenhum deploy foi feito na Vercel.
- Esta alteração remove o acesso pela interface do site; não apaga nem migra dados e não desativa por si só endpoints de backend já existentes.
