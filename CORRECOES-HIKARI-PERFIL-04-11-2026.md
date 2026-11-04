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

## Correções adicionais — seguidores, identidade visual e notificações

### 8. Lista de seguidores e pessoas seguidas
- Os nomes e avatares das pessoas nas listas de seguidores/seguindo agora são controles clicáveis.
- Ao selecionar uma pessoa, o modal fecha e o Hikari Perfil abre o perfil correspondente.
- Ações administrativas da lista (deixar de seguir, remover seguidor e bloquear) continuam separadas e preservadas.

### 9. Identidade visual Hikari Perfil
- Removido o caractere japonês usado como marca nas telas de entrada, cabeçalho e carregamento.
- O nome exibido passa a ser somente “Hikari Perfil”.
- Criada a animação exclusiva “Brilho Aurora”, com reflexo violeta/lavanda em movimento lento, distinta da animação do nome do proprietário.
- A animação respeita `prefers-reduced-motion`.

### 10. Notificações — auditoria e persistência
- As notificações de novo seguidor, solicitação para seguir e solicitação aceita passam a ser gravadas também na coleção Firestore `hikari_user_notifications`, para não depender exclusivamente do arquivo local/RAM da instância serverless.
- A consulta de notificações combina os registros Firestore com o estado social em memória, removendo duplicatas pelo ID.
- A ação de marcar como lida/ todas como lidas atualiza o estado local e a cópia persistente no Firestore.
- O acesso continua restrito ao UID autenticado do próprio titular.
- Limitação identificada na auditoria: o Hikari Perfil reconhece os tipos `comment_like` e `comment_reply` na navegação, mas este projeto não contém os fluxos que criam esses eventos; a aba de comentários é somente de visualização. Portanto, curtidas/respostas a comentários não podem gerar notificações até que a funcionalidade de interação correspondente exista e esteja integrada.
- A persistência Firestore depende de `FIREBASE_SERVICE_ACCOUNT_KEY` (ou `GOOGLE_APPLICATION_CREDENTIALS`) configurada no backend. Sem essas credenciais, a API usa o estado disponível no social store e registra a indisponibilidade no log.

### Validação desta etapa
- ZIP de entrada verificado antes da edição.
- Transpilação/sintaxe TypeScript verificada nos cinco arquivos TS/TSX alterados.
- Build completo e testes de integração não executados: o pacote recebido não contém `node_modules`.
- Nenhum deploy, publicação ou alteração remota foi realizado.
