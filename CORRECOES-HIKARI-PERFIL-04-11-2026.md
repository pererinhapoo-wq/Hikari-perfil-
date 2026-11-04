# Correções do Hikari Perfil — 04/11/2026

## Alterações aplicadas

1. **Deixar de seguir:** a remoção do vínculo autenticado agora exige confirmação da API e remove explicitamente o usuário dos arrays locais de seguindo/solicitações. Isso evita que um array vazio retornado pelo servidor seja interpretado como ausência de atualização e restaure o estado antigo do cache. A ação na janela de seguidores também aguarda confirmação antes de atualizar a interface.
2. **Denunciar perfil:** adicionado botão e diálogo de denúncia com motivos e detalhes opcionais. O endpoint exige autenticação, valida os campos, evita denúncia pendente duplicada para o mesmo perfil e grava no Firestore usando Firebase Admin. As denúncias reais são exibidas na área de Moderação do painel administrativo. Nenhuma punição automática é aplicada.
3. **Imagens e rolagem:** a lista de animes já utilizava virtualização; o buffer de linhas fora da tela foi reduzido e as imagens de cards/atividade/favoritos agora usam carregamento lazy, decodificação assíncrona e prioridade baixa.
4. **Perfis privados:** visitantes veem apenas o aviso “Esta conta é privada”; cabeçalho do perfil, abas, estatísticas e conteúdo ficam ocultos. O bloqueio de acesso já existente no backend e a proteção das projeções privadas foram mantidos.
5. **MyAnimeList:** removida a seção de conexão/importação da interface e desregistradas as rotas MAL no servidor e na função Vercel. Ao salvar configurações, a conta MAL fica marcada como desconectada. Os animes e demais itens já importados não são apagados nem filtrados.
6. **AniList:** a integração continua disponível. O tratamento existente de desconexão do AniList e a preservação de favoritos manuais foram mantidos.

## Preservações

- Mensagens privadas continuam desativadas na interface; histórico e código foram preservados.
- Dados de animes importados do MyAnimeList foram preservados.
- Nenhum deploy, publicação ou alteração direta no Firebase/GitHub foi realizado.

## Validação

- ZIP de origem extraído sem erros.
- 110 arquivos TypeScript/TSX passaram pela verificação de sintaxe/transpilação.
- O helper de favoritos AniList passou na verificação TypeScript isolada.
- Build completo e testes integrados não foram executados: o ZIP não contém `node_modules`, e as dependências do projeto não estão instaladas neste ambiente. É necessário instalar as dependências e validar no Preview antes de publicar.
- O envio de denúncias depende da configuração das credenciais Firebase Admin no backend (`FIREBASE_SERVICE_ACCOUNT_KEY` ou credenciais equivalentes).

## Correção adicional 7 — Persistência de foto e banner (incluindo GIF)
- Uploads locais de avatar e banner agora são enviados ao endpoint autenticado `/api/media/upload` antes de atualizar o perfil.
- O workspace passa a armazenar a URL permanente do Vercel Blob, em vez de depender de uma Data URL temporária/base64 no estado do navegador.
- O backend reconhece GIF87a e GIF89a e envia o arquivo com `Content-Type: image/gif`, preservando a animação original.
- JPEG, PNG e WebP continuam aceitos. O limite de upload permanece em 5 MB por arquivo.
- A URL final é gravada pelo fluxo existente de persistência do workspace/Firestore e da projeção pública do perfil.
- O upload exige sessão autenticada e a variável `HIKARI_PERFIL_BLOB_READ_WRITE_TOKEN` configurada no ambiente de servidor/Preview/produção. Se o armazenamento não estiver configurado, a interface informa a falha em vez de aparentar que a imagem foi salva.
