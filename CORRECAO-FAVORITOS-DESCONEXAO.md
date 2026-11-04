# Correção: favoritos externos após desconectar o AniList

## O que mudou
- Ao desconectar o AniList, o workspace autenticado remove personagens importados com IDs `char_al_*`, estúdios/produtoras `comp_al_*` e profissionais `person_al_*`.
- A mesma limpeza é aplicada ao perfil de demonstração.
- Itens manuais com IDs próprios são preservados. Quando um estúdio/profissional manual recebeu apenas um `anilistId` para enriquecer seus dados, o vínculo externo é removido, mas o item manual permanece.
- A alteração passa pelo fluxo normal de atualização do workspace, incluindo persistência local/Firestore e atualização da projeção pública.
- A desativação temporária das mensagens privadas do ZIP anterior foi preservada. Nenhuma conversa ou mensagem foi apagada.

## Importante sobre MyAnimeList
A integração MyAnimeList deste projeto importa a lista de animes pela API oficial utilizada; ela não importa favoritos de personagens, estúdios ou profissionais. Portanto, desconectar apenas o MyAnimeList não deve apagar esses favoritos, pois eles são dados provenientes do AniList ou inseridos manualmente. Se o AniList também for desconectado, os itens identificados como importados dele serão removidos.

## Limitação de validação
O ZIP foi verificado estruturalmente. Não foi possível executar `npm run lint` nem `npm run build` porque as dependências (`node_modules`) não estão instaladas neste ambiente. O TypeScript global iniciou, mas reportou módulos ausentes (React, Firebase, Express e tipos Node), impedindo uma validação completa. Teste no Preview antes de publicar.
