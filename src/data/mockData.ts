import { 
  UserProfile, 
  AnimeItem, 
  HikariComment, 
  UserActivity, 
  FollowUser, 
  FollowRequest, 
  NotificationItem,
  FavoriteCharacter,
  FavoriteCompany,
  FavoritePerson
} from '../types';

export const CURRENT_USER: UserProfile = {
  id: 'usr_hikari_001',
  username: 'ren_hikari',
  displayName: 'Ren Amano',
  avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
  bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
  bio: 'Explorador de shounen sombrio, cyberpunk e narrativas psicológicas. Moderador de discussões de fim de temporada no Hikari.',
  createdAt: '18 de agosto de 2023',
  createdAtTimestamp: 1692350400000,
  followersCount: 1420,
  followingCount: 388,
  isPrivate: true,
  showCommentsOnProfile: true,
  privacySettings: {
    showAnimeList: true,
    showFavorites: true,
    showActivity: true,
    showCommentsOnProfile: true
  },
  externalAccounts: {
    anilist: { connected: false, username: undefined, avatarUrl: undefined },
    mal: { connected: false, username: undefined, avatarUrl: undefined }
  }
};

export const OTHER_USERS: Record<string, UserProfile> = {
  'usr_kuroha': {
    id: 'usr_kuroha',
    username: 'kuroha_void',
    displayName: 'Kuroha ✦',
    avatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
    bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
    bio: 'Colecionadora de trilhas sonoras orquestrais e apreciadora de animes de ficção científica e mistério.',
    createdAt: '05 de janeiro de 2024',
    createdAtTimestamp: 1704456000000,
    followersCount: 894,
    followingCount: 215,
    isPrivate: true,
    showCommentsOnProfile: false,
    privacySettings: {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: false
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  },
  'usr_shinji': {
    id: 'usr_shinji',
    username: 'shinji_mecha',
    displayName: 'Shinji Kazuki',
    avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
    bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
    bio: 'Crítico amador de mechas, animação fluida e direções de arte dos anos 90.',
    createdAt: '12 de novembro de 2023',
    createdAtTimestamp: 1699786800000,
    followersCount: 520,
    followingCount: 190,
    isPrivate: false,
    showCommentsOnProfile: true,
    privacySettings: {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  }
};

export const INITIAL_ANIMES: AnimeItem[] = [
  {
    id: 'anime_solo_leveling',
    title: 'Solo Leveling (Arise)',
    titleRomaji: 'Ore dake Level Up na Ken',
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80',
    status: 'watching',
    currentEpisode: 10,
    totalEpisodes: 12,
    rating: 9.4,
    isFavorite: true,
    year: 2024,
    genres: ['Ação', 'Fantasia Sombria']
  },
  {
    id: 'anime_frieren',
    title: 'Frieren: Beyond Journey\'s End',
    titleRomaji: 'Sousou no Frieren',
    posterUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 9.8,
    isFavorite: true,
    year: 2023,
    genres: ['Aventura', 'Drama', 'Fantasia']
  },
  {
    id: 'anime_cyberpunk',
    title: 'Cyberpunk: Edgerunners',
    titleRomaji: 'Cyberpunk: Edgerunners',
    posterUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 10,
    totalEpisodes: 10,
    rating: 9.6,
    isFavorite: true,
    year: 2022,
    genres: ['Sci-Fi', 'Ação', 'Psicológico']
  },
  {
    id: 'anime_jujutsu',
    title: 'Jujutsu Kaisen 2ª Temporada',
    titleRomaji: 'Jujutsu Kaisen Season 2',
    posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 23,
    totalEpisodes: 23,
    rating: 9.2,
    isFavorite: false,
    year: 2023,
    genres: ['Ação', 'Sobrenatural']
  },
  {
    id: 'anime_chainsaw',
    title: 'Chainsaw Man',
    titleRomaji: 'Chainsaw Man',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 12,
    totalEpisodes: 12,
    rating: 8.9,
    isFavorite: false,
    year: 2022,
    genres: ['Ação', 'Gore', 'Comédia Sombria']
  },
  {
    id: 'anime_steins_gate',
    title: 'Steins;Gate',
    titleRomaji: 'Steins;Gate',
    posterUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 24,
    totalEpisodes: 24,
    rating: 9.7,
    isFavorite: true,
    year: 2011,
    genres: ['Sci-Fi', 'Suspense', 'Drama']
  },
  {
    id: 'anime_kaiju8',
    title: 'Kaiju No. 8',
    titleRomaji: 'Kaijuu 8-gou',
    posterUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500&auto=format&fit=crop&q=80',
    status: 'watching',
    currentEpisode: 6,
    totalEpisodes: 12,
    rating: 8.5,
    isFavorite: false,
    year: 2024,
    genres: ['Ação', 'Militar', 'Monstros']
  },
  {
    id: 'anime_bleach_tybw',
    title: 'Bleach: Thousand-Year Blood War',
    titleRomaji: 'Bleach: Sennen Kessen-hen',
    posterUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop&q=80',
    status: 'planned',
    currentEpisode: 0,
    totalEpisodes: 26,
    rating: 0,
    isFavorite: false,
    year: 2024,
    genres: ['Shounen', 'Ação', 'Sobrenatural']
  },
  {
    id: 'anime_vinland',
    title: 'Vinland Saga 2ª Temporada',
    titleRomaji: 'Vinland Saga Season 2',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80',
    status: 'on_hold',
    currentEpisode: 14,
    totalEpisodes: 24,
    rating: 9.3,
    isFavorite: false,
    year: 2023,
    genres: ['Histórico', 'Drama', 'Aventura']
  },
  {
    id: 'anime_evangelion',
    title: 'Neon Genesis Evangelion',
    titleRomaji: 'Shin Seiki Evangelion',
    posterUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 26,
    totalEpisodes: 26,
    rating: 9.7,
    isFavorite: true,
    year: 1995,
    genres: ['Mecha', 'Psicológico', 'Drama']
  },
  {
    id: 'anime_death_note',
    title: 'Death Note',
    titleRomaji: 'Death Note',
    posterUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 37,
    totalEpisodes: 37,
    rating: 9.1,
    isFavorite: false,
    year: 2006,
    genres: ['Mistério', 'Psicológico', 'Suspense']
  },
  {
    id: 'anime_demon_slayer',
    title: 'Demon Slayer: Kimetsu no Yaiba',
    titleRomaji: 'Kimetsu no Yaiba Hashira Geiko-hen',
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=80',
    status: 'watching',
    currentEpisode: 5,
    totalEpisodes: 8,
    rating: 8.8,
    isFavorite: false,
    year: 2024,
    genres: ['Ação', 'Sobrenatural', 'Histórico']
  },
  {
    id: 'anime_attack_titan',
    title: 'Attack on Titan: The Final Season',
    titleRomaji: 'Shingeki no Kyojin',
    posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 28,
    totalEpisodes: 28,
    rating: 9.9,
    isFavorite: true,
    year: 2023,
    genres: ['Ação', 'Fantasia Sombria', 'Drama']
  },
  {
    id: 'anime_bocchi',
    title: 'Bocchi the Rock!',
    titleRomaji: 'Bocchi the Rock!',
    posterUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 12,
    totalEpisodes: 12,
    rating: 9.2,
    isFavorite: true,
    year: 2022,
    genres: ['Comédia', 'Música', 'Slice of Life']
  },
  {
    id: 'anime_mob_psycho',
    title: 'Mob Psycho 100 III',
    titleRomaji: 'Mob Psycho 100 3rd Season',
    posterUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&auto=format&fit=crop&q=80',
    status: 'completed',
    currentEpisode: 12,
    totalEpisodes: 12,
    rating: 9.5,
    isFavorite: false,
    year: 2022,
    genres: ['Ação', 'Comédia', 'Sobrenatural']
  },
  {
    id: 'anime_dandadan',
    title: 'Dandadan',
    titleRomaji: 'Dandadan',
    posterUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop&q=80',
    status: 'planned',
    currentEpisode: 0,
    totalEpisodes: 12,
    rating: 0,
    isFavorite: false,
    year: 2024,
    genres: ['Ação', 'Comédia', 'Sobrenatural']
  },
  {
    id: 'anime_promised_neverland_s2',
    title: 'The Promised Neverland 2ª Temporada',
    titleRomaji: 'Yakusoku no Neverland 2',
    posterUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500&auto=format&fit=crop&q=80',
    status: 'dropped',
    currentEpisode: 4,
    totalEpisodes: 11,
    rating: 4.5,
    isFavorite: false,
    year: 2021,
    genres: ['Suspense', 'Mistério', 'Ficção Científica']
  },
  {
    id: 'anime_tokyo_ghoul_re',
    title: 'Tokyo Ghoul:re',
    titleRomaji: 'Tokyo Ghoul:re',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop&q=80',
    status: 'dropped',
    currentEpisode: 6,
    totalEpisodes: 24,
    rating: 5.0,
    isFavorite: false,
    year: 2018,
    genres: ['Ação', 'Drama', 'Sobrenatural']
  }
];

export const INITIAL_COMMENTS: HikariComment[] = [
  {
    id: 'comm_01',
    animeId: 'anime_frieren',
    animeTitle: 'Frieren: Beyond Journey\'s End',
    episodeNumber: 26,
    discussionTopic: 'O teste dos magos de 1ª classe e a revelação do clone',
    content: 'A direção dessa luta foi uma obra-prima de ritmo e contenção. Ao invés de explosões ensurdecedoras contínuas, cada feitiço teve peso sonoro tangível e silêncio dramático impecável.',
    createdAt: 'Há 3 dias',
    likesCount: 142,
    repliesCount: 19,
    originUrl: 'https://hikari.tv/anime/frieren/ep-26#comment-8942'
  },
  {
    id: 'comm_02',
    animeId: 'anime_solo_leveling',
    animeTitle: 'Solo Leveling (Arise)',
    episodeNumber: 8,
    discussionTopic: 'A evolução de Sung Jinwoo e a trilha de Hiroyuki Sawano',
    content: 'A sincronia entre a animação das sombras e o drop da trilha de Sawano quando o Jinwoo invocou o exército de cavaleiros arrepiou a espinha. O Hikari entregou a melhor compressão de bitrate para essa cena!',
    createdAt: 'Há 1 semana',
    likesCount: 218,
    repliesCount: 34,
    originUrl: 'https://hikari.tv/anime/solo-leveling/ep-8#comment-10492'
  },
  {
    id: 'comm_03',
    animeId: 'anime_cyberpunk',
    animeTitle: 'Cyberpunk: Edgerunners',
    episodeNumber: 10,
    discussionTopic: 'Final da série e reflexões sobre Night City',
    content: 'Um desfecho inevitável e poético. Em Night City ninguém vence o sistema; o máximo que se conquista é escolher por quem queimar até o fim.',
    createdAt: 'Há 3 semanas',
    likesCount: 560,
    repliesCount: 78,
    originUrl: 'https://hikari.tv/anime/cyberpunk-edgerunners/ep-10#comment-4491'
  }
];

export const INITIAL_ACTIVITIES: UserActivity[] = [
  {
    id: 'act_01',
    type: 'watched_ep',
    title: 'Assistiu ao episódio 10',
    description: 'Solo Leveling (Arise)',
    timestamp: 'Há 2 horas',
    episode: 10
  },
  {
    id: 'act_02',
    type: 'rated',
    title: 'Avaliou com nota 9.8 ★',
    description: 'Frieren: Beyond Journey\'s End',
    timestamp: 'Ontem',
    score: 9.8
  },
  {
    id: 'act_03',
    type: 'completed_anime',
    title: 'Concluiu a obra',
    description: 'Cyberpunk: Edgerunners (10/10 eps)',
    timestamp: 'Há 3 dias'
  },
  {
    id: 'act_04',
    type: 'commented',
    title: 'Publicou um comentário em discussão oficial',
    description: 'Frieren: Beyond Journey\'s End — Ep 26',
    timestamp: 'Há 3 dias'
  },
  {
    id: 'act_05',
    type: 'added_favorite',
    title: 'Adicionou aos Favoritos em destaque',
    description: 'Steins;Gate',
    timestamp: 'Há 1 semana'
  }
];

export const INITIAL_FOLLOWERS: FollowUser[] = [
  {
    id: 'usr_kuroha',
    username: 'kuroha_void',
    displayName: 'Kuroha ✦',
    avatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
    bio: 'Colecionadora de trilhas sonoras orquestrais e sci-fi.',
    isFollowing: true,
    isRequested: false,
    isFollower: true,
    isBlocked: false,
    createdAt: '05 de janeiro de 2024'
  },
  {
    id: 'usr_maya',
    username: 'maya_sakura',
    displayName: 'Maya Sakura',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    bio: 'Fã de slice-of-life, Kyoto Animation e mangás românticos.',
    isFollowing: true,
    isRequested: false,
    isFollower: true,
    isBlocked: false,
    createdAt: '19 de setembro de 2023'
  },
  {
    id: 'usr_daiki',
    username: 'daiki_sub',
    displayName: 'Daiki Tanaka',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    bio: 'Tradutor voluntário e caçador de referências nos encerramentos.',
    isFollowing: false,
    isRequested: false,
    isFollower: true,
    isBlocked: false,
    createdAt: '22 de outubro de 2023'
  }
];

export const INITIAL_FOLLOWING: FollowUser[] = [
  {
    id: 'usr_kuroha',
    username: 'kuroha_void',
    displayName: 'Kuroha ✦',
    avatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg',
    bio: 'Colecionadora de trilhas sonoras orquestrais e sci-fi.',
    isFollowing: true,
    isRequested: false,
    isFollower: true,
    isBlocked: false,
    createdAt: '05 de janeiro de 2024'
  },
  {
    id: 'usr_maya',
    username: 'maya_sakura',
    displayName: 'Maya Sakura',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    bio: 'Fã de slice-of-life, Kyoto Animation e mangás românticos.',
    isFollowing: true,
    isRequested: false,
    isFollower: true,
    isBlocked: false,
    createdAt: '19 de setembro de 2023'
  },
  {
    id: 'usr_shinji',
    username: 'shinji_mecha',
    displayName: 'Shinji Kazuki',
    avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg',
    bio: 'Crítico de animação fluida e mechas dos anos 90.',
    isFollowing: true,
    isRequested: false,
    isFollower: false,
    isBlocked: false,
    createdAt: '12 de novembro de 2023'
  }
];

export const INITIAL_FOLLOW_REQUESTS: FollowRequest[] = [
  {
    id: 'req_01',
    user: {
      id: 'usr_yuki',
      username: 'yuki_frost',
      displayName: 'Yuki Vinter',
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80',
      bio: 'Apaixonado por isekai e fantasia medieval.',
      isFollowing: false,
      isRequested: false,
      isFollower: false,
      isBlocked: false,
      createdAt: '14 de fevereiro de 2024'
    },
    requestedAt: 'Há 40 minutos'
  },
  {
    id: 'req_02',
    user: {
      id: 'usr_toru',
      username: 'toru_blade',
      displayName: 'Toru Honda',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
      bio: 'Maratonando animes clássicos toda sexta.',
      isFollowing: false,
      isRequested: false,
      isFollower: false,
      isBlocked: false,
      createdAt: '01 de março de 2024'
    },
    requestedAt: 'Há 5 horas'
  }
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif_01',
    type: 'new_follower',
    actor: {
      displayName: 'Daiki Tanaka',
      username: 'daiki_sub',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80'
    },
    message: 'começou a seguir o seu perfil.',
    createdAt: 'Há 15 minutos',
    isRead: false,
    contextData: {
      modal: 'followers',
      modalTab: 'followers',
      userId: 'usr_daiki'
    }
  },
  {
    id: 'notif_02',
    type: 'follow_request',
    actor: {
      displayName: 'Yuki Vinter',
      username: 'yuki_frost',
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80'
    },
    message: 'enviou uma solicitação para seguir você.',
    createdAt: 'Há 40 minutos',
    isRead: false,
    contextData: {
      modal: 'followers',
      modalTab: 'requests',
      userId: 'usr_yuki',
      requestId: 'req_01'
    }
  },
  {
    id: 'notif_03',
    type: 'comment_like',
    actor: {
      displayName: 'Kuroha ✦',
      username: 'kuroha_void',
      avatarUrl: '/src/assets/images/hikari_follower_avatar_1793518826589.jpg'
    },
    message: 'curtiu seu comentário em Frieren: Beyond Journey\'s End (Ep 26).',
    createdAt: 'Há 2 horas',
    isRead: true,
    targetLink: 'https://hikari.tv/anime/frieren/ep-26#comment-8942',
    contextData: {
      tab: 'comments',
      commentId: 'comm_01'
    }
  },
  {
    id: 'notif_04',
    type: 'request_accepted',
    actor: {
      displayName: 'Shinji Kazuki',
      username: 'shinji_mecha',
      avatarUrl: '/src/assets/images/hikari_user_avatar_1793518815544.jpg'
    },
    message: 'aceitou sua solicitação para seguir.',
    createdAt: 'Ontem',
    isRead: true,
    contextData: {
      modal: 'followers',
      modalTab: 'following',
      userId: 'usr_shinji'
    }
  }
];

export const FAVORITE_CHARACTERS: FavoriteCharacter[] = [
  {
    id: 'char_01',
    name: 'Frieren',
    originalName: 'フリーレン',
    animeName: 'Sousou no Frieren',
    role: 'Protagonista',
    imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_02',
    name: 'Sung Jin-woo',
    originalName: '성진우',
    animeName: 'Solo Leveling',
    role: 'Monarca das Sombras',
    imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_03',
    name: 'Gojou Satoru',
    originalName: '五条悟',
    animeName: 'Jujutsu Kaisen',
    role: 'Feiticeiro Especial',
    imageUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_04',
    name: 'David Martinez',
    originalName: 'デイビッド',
    animeName: 'Cyberpunk: Edgerunners',
    role: 'Mercenário / Edgerunner',
    imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_05',
    name: 'Makima',
    originalName: 'マキマ',
    animeName: 'Chainsaw Man',
    role: 'Líder da Segurança Pública',
    imageUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_06',
    name: 'Levi Ackerman',
    originalName: 'リヴァイ・アッカーマン',
    animeName: 'Attack on Titan',
    role: 'Capitão da Tropa de Exploração',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_07',
    name: 'Fern',
    originalName: 'フェルン',
    animeName: 'Sousou no Frieren',
    role: 'Maga Ordinária de Primeira Classe',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_08',
    name: 'Loid Forger',
    originalName: 'ロイド・フォージャー',
    animeName: 'SPY x FAMILY',
    role: 'Espião (Twilight)',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_09',
    name: 'Roronoa Zoro',
    originalName: 'ロロノア・ゾロ',
    animeName: 'One Piece',
    role: 'Espadachim dos Chapéus de Palha',
    imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80'
  },
  {
    id: 'char_10',
    name: 'Violet Evergarden',
    originalName: 'ヴァイオレット・エヴァーガーデン',
    animeName: 'Violet Evergarden',
    role: 'Autômata de Automemórias',
    imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&auto=format&fit=crop&q=80'
  }
];

export const FAVORITE_COMPANIES: FavoriteCompany[] = [
  {
    id: 'comp_01',
    name: 'Madhouse',
    type: 'Estúdio de Animação',
    notableWorks: 'Sousou no Frieren, Hunter x Hunter, Death Note',
    logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_02',
    name: 'MAPPA',
    type: 'Estúdio de Animação',
    notableWorks: 'Jujutsu Kaisen, Chainsaw Man, Attack on Titan Final',
    logoUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_03',
    name: 'ufotable',
    type: 'Estúdio de Animação & VFX',
    notableWorks: 'Demon Slayer, Fate/stay night: Heaven\'s Feel',
    logoUrl: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_04',
    name: 'CloverWorks',
    type: 'Estúdio de Animação',
    notableWorks: 'Bocchi the Rock!, The Promised Neverland, Spy x Family',
    logoUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_05',
    name: 'A-1 Pictures',
    type: 'Estúdio de Animação',
    notableWorks: 'Solo Leveling, 86: Eighty Six, Kaguya-sama',
    logoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_06',
    name: 'Kyoto Animation',
    type: 'Estúdio de Animação & Arte',
    notableWorks: 'Violet Evergarden, A Silent Voice, Hyouka',
    logoUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_07',
    name: 'WIT Studio',
    type: 'Estúdio de Animação',
    notableWorks: 'Vinland Saga S1, Spy x Family, Vivy',
    logoUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_08',
    name: 'Trigger',
    type: 'Estúdio de Animação Autoral',
    notableWorks: 'Cyberpunk: Edgerunners, Kill la Kill, Delicious in Dungeon',
    logoUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_09',
    name: 'Bones',
    type: 'Estúdio de Animação',
    notableWorks: 'Mob Psycho 100, Fullmetal Alchemist: Brotherhood',
    logoUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'comp_10',
    name: 'Aniplex',
    type: 'Produtora & Distribuidora',
    notableWorks: 'Demon Slayer, Sword Art Online, Fate Series',
    logoUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&auto=format&fit=crop&q=80'
  }
];

export const FAVORITE_PEOPLE: FavoritePerson[] = [
  {
    id: 'person_01',
    name: 'Hiroyuki Sawano',
    role: 'Compositor & Produtor Musical',
    notableWork: 'Attack on Titan, Solo Leveling, Kill la Kill',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_02',
    name: 'Keiichirou Saitou',
    role: 'Diretor de Animação',
    notableWork: 'Sousou no Frieren, Bocchi the Rock!',
    imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_03',
    name: 'Makoto Shinkai',
    role: 'Diretor & Roteirista de Cinema',
    notableWork: 'Your Name, Weathering With You, Suzume',
    imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_04',
    name: 'Kenjiro Tsuda',
    role: 'Dublador / Seiyuu',
    notableWork: 'Kento Nanami (JJK), Kishibe (Chainsaw Man)',
    imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_05',
    name: 'Rie Takahashi',
    role: 'Dubladora / Seiyuu',
    notableWork: 'Megumin (KonoSuba), Ai Hoshino (Oshi no Ko)',
    imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_06',
    name: 'Yuki Kaji',
    role: 'Dublador / Seiyuu',
    notableWork: 'Eren Yeager (AOT), Shoto Todoroki (MHA)',
    imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_07',
    name: 'Evan Call',
    role: 'Compositor Orquestral',
    notableWork: 'Sousou no Frieren, Violet Evergarden',
    imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_08',
    name: 'Shingo Yamashita',
    role: 'Animador & Diretor de Aberturas',
    notableWork: 'Jujutsu Kaisen OP1, Chainsaw Man ED',
    imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_09',
    name: 'Aoi Yuuki',
    role: 'Dubladora / Seiyuu',
    notableWork: 'Tanya Degurechaff, Madoka Kaname, Maomao',
    imageUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80'
  },
  {
    id: 'person_10',
    name: 'Hiromu Arakawa',
    role: 'Mangaká Autora',
    notableWork: 'Fullmetal Alchemist, Silver Spoon',
    imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&auto=format&fit=crop&q=80'
  }
];
