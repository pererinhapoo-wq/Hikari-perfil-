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
  FavoritePerson,
  AUTHORIZED_ADMIN_UID
} from '../types/index.js';

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
    showCommentsOnProfile: true,
    allowDirectMessages: true,
    directMessagesFrom: 'everyone'
  },
  externalAccounts: {
    anilist: { connected: false, username: undefined, avatarUrl: undefined },
    mal: { connected: false, username: undefined, avatarUrl: undefined }
  }
};

export const AETHER_OWNER_PROFILE: UserProfile = {
  id: AUTHORIZED_ADMIN_UID,
  username: 'aether',
  displayName: 'Aether',
  avatarUrl: '',
  bannerUrl: '',
  bio: 'Guardião do ecossistema Hikari e apreciador de narrativas profundas e inesquecíveis.',
  createdAt: '01 de janeiro de 2023',
  createdAtTimestamp: 1672531200000,
  followersCount: 4280,
  followingCount: 1,
  isPrivate: false,
  showCommentsOnProfile: true,
  privacySettings: {
    showAnimeList: true,
    showFavorites: true,
    showActivity: true,
    showCommentsOnProfile: true,
    allowDirectMessages: true,
    directMessagesFrom: 'everyone',
    showOnlineStatus: true,
  },
  externalAccounts: {
    anilist: { connected: false },
    mal: { connected: false },
  },
};

export const OTHER_USERS: Record<string, UserProfile> = {
  [AUTHORIZED_ADMIN_UID]: AETHER_OWNER_PROFILE,
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
      showCommentsOnProfile: false,
      allowDirectMessages: true,
      directMessagesFrom: 'followers'
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
    avatarUrl: '',
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
      showCommentsOnProfile: true,
      allowDirectMessages: true,
      directMessagesFrom: 'everyone'
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  },
  'usr_maya': {
    id: 'usr_maya',
    username: 'maya_sakura',
    displayName: 'Maya Sakura',
    avatarUrl: '',
    bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
    bio: 'Fã de slice-of-life, Kyoto Animation e mangás românticos.',
    createdAt: '19 de setembro de 2023',
    createdAtTimestamp: 1695124800000,
    followersCount: 310,
    followingCount: 140,
    isPrivate: false,
    showCommentsOnProfile: true,
    privacySettings: {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
      allowDirectMessages: true,
      directMessagesFrom: 'mutual'
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  },
  'usr_daiki': {
    id: 'usr_daiki',
    username: 'daiki_sub',
    displayName: 'Daiki Tanaka',
    avatarUrl: '',
    bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
    bio: 'Tradutor voluntário e caçador de referências nos encerramentos.',
    createdAt: '22 de outubro de 2023',
    createdAtTimestamp: 1697976000000,
    followersCount: 154,
    followingCount: 92,
    isPrivate: false,
    showCommentsOnProfile: true,
    privacySettings: {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
      allowDirectMessages: false,
      directMessagesFrom: 'everyone'
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  },
  'usr_mateus': {
    id: 'usr_mateus',
    username: 'mateus_silva',
    displayName: 'Mateus Silva',
    avatarUrl: '',
    bannerUrl: '/src/assets/images/hikari_profile_banner_1793518804213.jpg',
    bio: 'Entusiasta de animes clássicos, animação moderna e trilhas sonoras orquestrais.',
    createdAt: '14 de março de 2024',
    createdAtTimestamp: 1710374400000,
    followersCount: 342,
    followingCount: 118,
    isPrivate: false,
    showCommentsOnProfile: true,
    privacySettings: {
      showAnimeList: true,
      showFavorites: true,
      showActivity: true,
      showCommentsOnProfile: true,
      allowDirectMessages: true,
      directMessagesFrom: 'everyone'
    },
    externalAccounts: {
      anilist: { connected: false },
      mal: { connected: false }
    }
  }
};

export const AETHER_ANIMES: AnimeItem[] = [
  {
    id: 'anime_gintama_final',
    title: 'Gintama: THE FINAL',
    titleRomaji: 'Gintama: THE FINAL',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx110686-2E1Hw6Wp4sXl.jpg',
    status: 'completed',
    currentEpisode: 1,
    totalEpisodes: 1,
    rating: 10,
    isFavorite: true,
    year: 2021,
    genres: ['Ação', 'Comédia', 'Paródia', 'Sci-Fi'],
  },
  {
    id: 'anime_gintama_s1',
    title: 'Gintama',
    titleRomaji: 'Gintama',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx918-zM01T7G1B4sC.jpg',
    status: 'completed',
    currentEpisode: 201,
    totalEpisodes: 201,
    rating: 9.9,
    isFavorite: true,
    year: 2006,
    genres: ['Ação', 'Comédia', 'Paródia', 'Samurai'],
  },
  {
    id: 'anime_samurai_champloo',
    title: 'Samurai Champloo',
    titleRomaji: 'Samurai Champloo',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx205-i39k4k4N4b.jpg',
    status: 'completed',
    currentEpisode: 26,
    totalEpisodes: 26,
    rating: 9.7,
    isFavorite: true,
    year: 2004,
    genres: ['Ação', 'Aventura', 'Comédia'],
  },
  {
    id: 'anime_nichijou',
    title: 'Nichijou - My Ordinary Life',
    titleRomaji: 'Nichijou',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx10165-dMwG3s4b8.jpg',
    status: 'completed',
    currentEpisode: 26,
    totalEpisodes: 26,
    rating: 9.5,
    isFavorite: true,
    year: 2011,
    genres: ['Comédia', 'Slice of Life'],
  },
  {
    id: 'anime_daily_lives',
    title: 'Daily Lives of High School Boys',
    titleRomaji: 'Danshi Koukousei no Nichijou',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx11843-c0dIe4u2f.jpg',
    status: 'completed',
    currentEpisode: 12,
    totalEpisodes: 12,
    rating: 9.4,
    isFavorite: true,
    year: 2012,
    genres: ['Comédia', 'Slice of Life'],
  },
];

export const INITIAL_ANIMES: AnimeItem[] = [
  {
    id: 'anime_solo_leveling',
    title: 'Solo Leveling (Arise)',
    titleRomaji: 'Ore dake Level Up na Ken',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gviZ5zgQL7ee.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx120377-p4RwqR4rDlsG.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx145064-0vg36FimA4rI.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127230-FloCoGoLob48.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx9253-7pdcPAuaTW5C.png',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx153288-E2jR5k338o7R.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx114446-pG4r1S7z7k6n.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx136430-mQ9Dmg9nBvhT.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-3W8YpG64z52X.png',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1535-64jN1om9wU5y.png',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx166240-Z9uJq7pX0l2W.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx110277-2q1K52gL9V2Y.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx130003-51A07b5uF4yS.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140439-d3uM51wQ0uGk.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx171018-bT1Fw225jZ1T.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx108725-783E9L69x1K0.jpg',
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
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx100240-E0jJ5z2s3c0v.jpg',
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
    createdAtTimestamp: Date.now() - 2 * 3600 * 1000,
    episode: 10,
    animeId: 'anime_solo_leveling',
    animeTitle: 'Solo Leveling (Arise)',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-33eBWSZuVOdH.jpg'
  },
  {
    id: 'act_02',
    type: 'rated',
    title: 'Avaliou com nota 9.8 ★',
    description: 'Frieren: Beyond Journey\'s End',
    timestamp: 'Ontem',
    createdAtTimestamp: Date.now() - 26 * 3600 * 1000,
    score: 9.8,
    animeId: 'anime_frieren',
    animeTitle: 'Frieren: Beyond Journey\'s End',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gviZ5zgQL7ee.jpg'
  },
  {
    id: 'act_03',
    type: 'completed_anime',
    title: 'Concluiu a obra',
    description: 'Cyberpunk: Edgerunners (10/10 eps)',
    timestamp: 'Há 3 dias',
    createdAtTimestamp: Date.now() - 72 * 3600 * 1000,
    episode: 10,
    animeId: 'anime_cyberpunk',
    animeTitle: 'Cyberpunk: Edgerunners',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx120377-p4RwqR4rDlsG.jpg'
  },
  {
    id: 'act_04',
    type: 'commented',
    title: 'Publicou um comentário em discussão oficial',
    description: 'Frieren: Beyond Journey\'s End — Ep 26',
    timestamp: 'Há 3 dias',
    createdAtTimestamp: Date.now() - 74 * 3600 * 1000,
    episode: 26,
    animeId: 'anime_frieren',
    animeTitle: 'Frieren: Beyond Journey\'s End',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gviZ5zgQL7ee.jpg'
  },
  {
    id: 'act_05',
    type: 'added_favorite',
    title: 'Adicionou aos Favoritos em destaque',
    description: 'Steins;Gate',
    timestamp: 'Há 1 semana',
    createdAtTimestamp: Date.now() - 7 * 24 * 3600 * 1000,
    animeId: 'anime_steins_gate',
    animeTitle: 'Steins;Gate',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx9253-7pdcPAuaTW5C.png'
  },
  {
    id: 'act_06',
    type: 'completed_anime',
    title: 'Concluiu a obra',
    description: 'Chainsaw Man (12/12 eps)',
    timestamp: 'Há 10 dias',
    createdAtTimestamp: Date.now() - 10 * 24 * 3600 * 1000,
    episode: 12,
    animeId: 'anime_chainsaw',
    animeTitle: 'Chainsaw Man',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127230-FloCoGoLob48.jpg'
  },
  {
    id: 'act_07',
    type: 'watched_ep',
    title: 'Assistiu até o episódio 23',
    description: 'Jujutsu Kaisen 2ª Temporada',
    timestamp: 'Há 2 semanas',
    createdAtTimestamp: Date.now() - 14 * 24 * 3600 * 1000,
    episode: 23,
    animeId: 'anime_jujutsu',
    animeTitle: 'Jujutsu Kaisen 2ª Temporada',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx145064-0vg36FimA4rI.jpg'
  },
  {
    id: 'act_08',
    type: 'status_changed',
    title: 'Moveu Kaiju No. 8 para Assistindo',
    description: 'Progresso: 6/12 episódios',
    timestamp: 'Há 2 semanas',
    createdAtTimestamp: Date.now() - 16 * 24 * 3600 * 1000,
    episode: 6,
    animeId: 'anime_kaiju8',
    animeTitle: 'Kaiju No. 8',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx153288-E2jR5k338o7R.jpg'
  },
  {
    id: 'act_09',
    type: 'added_anime',
    title: 'Adicionou à lista Planejados',
    description: 'Bleach: Thousand-Year Blood War',
    timestamp: 'Há 3 semanas',
    createdAtTimestamp: Date.now() - 21 * 24 * 3600 * 1000,
    animeId: 'anime_bleach_tybw',
    animeTitle: 'Bleach: Thousand-Year Blood War',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx114446-pG4r1S7z7k6n.jpg'
  },
  {
    id: 'act_10',
    type: 'rated',
    title: 'Avaliou com nota 9.7 ★',
    description: 'Neon Genesis Evangelion',
    timestamp: 'Há 1 mês',
    createdAtTimestamp: Date.now() - 30 * 24 * 3600 * 1000,
    score: 9.7,
    animeId: 'anime_evangelion',
    animeTitle: 'Neon Genesis Evangelion',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-3W8YpG64z52X.png'
  },
  {
    id: 'act_11',
    type: 'status_changed',
    title: 'Colocou Vinland Saga 2ª Temporada em espera',
    description: 'Progresso: 14/24 episódios',
    timestamp: 'Há 1 mês',
    createdAtTimestamp: Date.now() - 35 * 24 * 3600 * 1000,
    episode: 14,
    animeId: 'anime_vinland',
    animeTitle: 'Vinland Saga 2ª Temporada',
    posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx136430-mQ9Dmg9nBvhT.jpg'
  },
  {
    id: 'act_12',
    type: 'commented',
    title: 'Publicou uma mensagem de boas-vindas no mural da comunidade',
    description: 'Participando dos tópicos sazonais de lançamentos de animes',
    timestamp: 'Há 2 meses',
    createdAtTimestamp: Date.now() - 60 * 24 * 3600 * 1000
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
    avatarUrl: '',
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
    avatarUrl: '',
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
    id: AUTHORIZED_ADMIN_UID,
    username: 'aether',
    displayName: 'Aether',
    avatarUrl: '',
    bio: 'Guardião do ecossistema Hikari.',
    isFollowing: true,
    isRequested: false,
    isFollower: false,
    isBlocked: false,
    createdAt: '01 de janeiro de 2023',
  },
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
    avatarUrl: '',
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
    avatarUrl: '',
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
      avatarUrl: '',
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
      avatarUrl: '',
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
      avatarUrl: ''
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
      avatarUrl: ''
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
      avatarUrl: ''
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
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b176754-PCnpqIOkjhFk.png'
  },
  {
    id: 'char_02',
    name: 'Sung Jin-woo',
    originalName: '성진우',
    animeName: 'Solo Leveling',
    role: 'Monarca das Sombras',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b129928-BCEjVaP0AQSw.png'
  },
  {
    id: 'char_03',
    name: 'Gojou Satoru',
    originalName: '五条悟',
    animeName: 'Jujutsu Kaisen',
    role: 'Feiticeiro Especial',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png'
  },
  {
    id: 'char_04',
    name: 'David Martinez',
    originalName: 'デイビッド',
    animeName: 'Cyberpunk: Edgerunners',
    role: 'Mercenário / Edgerunner',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b284158-z1uGKC3IYVa1.png'
  },
  {
    id: 'char_05',
    name: 'Makima',
    originalName: 'マキマ',
    animeName: 'Chainsaw Man',
    role: 'Líder da Segurança Pública',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b137080-UHcynYNjb5ZU.png'
  },
  {
    id: 'char_06',
    name: 'Levi Ackerman',
    originalName: 'リヴァイ・アッカーマン',
    animeName: 'Attack on Titan',
    role: 'Capitão da Tropa de Exploração',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b45627-CR68RyZmddGG.png'
  },
  {
    id: 'char_07',
    name: 'Fern',
    originalName: 'フェルン',
    animeName: 'Sousou no Frieren',
    role: 'Maga Ordinária de Primeira Classe',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b183965-uGFohBjlFoTp.png'
  },
  {
    id: 'char_08',
    name: 'Loid Forger',
    originalName: 'ロイド・フォージャー',
    animeName: 'SPY x FAMILY',
    role: 'Espião (Twilight)',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b138101-7NCB0Md8zA6G.png'
  },
  {
    id: 'char_09',
    name: 'Roronoa Zoro',
    originalName: 'ロロノア・ゾロ',
    animeName: 'One Piece',
    role: 'Espadachim dos Chapéus de Palha',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png'
  },
  {
    id: 'char_10',
    name: 'Violet Evergarden',
    originalName: 'ヴァイオレット・エヴァーガーデン',
    animeName: 'Violet Evergarden',
    role: 'Autômata de Automemórias',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b90169-4wr1Zehnsac8.png'
  }
];

export const FAVORITE_COMPANIES: FavoriteCompany[] = [
  {
    id: 'comp_01',
    name: 'Madhouse',
    type: 'Estúdio de Animação',
    notableWorks: 'Sousou no Frieren, Hunter x Hunter, Death Note',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/e68488ab-f0a0-411f-850a-18fb3e21b96c_600x600_i?s=21618c9c3183ffded748d303a253b637'
  },
  {
    id: 'comp_02',
    name: 'MAPPA',
    type: 'Estúdio de Animação',
    notableWorks: 'Jujutsu Kaisen, Chainsaw Man, Attack on Titan Final',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/e3a5163d-3b09-4e98-922b-79180a75539f_600x600_i?s=3289c478fd611569ebccd7ff076151df'
  },
  {
    id: 'comp_03',
    name: 'ufotable',
    type: 'Estúdio de Animação & VFX',
    notableWorks: 'Demon Slayer, Fate/stay night: Heaven\'s Feel',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/03171393-4a85-451d-a025-4a3f05d1aede_600x600_i?s=48ebfd25c277dd148d41f88568f60aa6'
  },
  {
    id: 'comp_04',
    name: 'CloverWorks',
    type: 'Estúdio de Animação',
    notableWorks: 'Bocchi the Rock!, The Promised Neverland, Spy x Family',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/75875b81-17bb-4f7e-a06f-bb149d54687e_600x600_i?s=b90a570d03511f70dbac7e04869f4835'
  },
  {
    id: 'comp_05',
    name: 'A-1 Pictures',
    type: 'Estúdio de Animação',
    notableWorks: 'Solo Leveling, 86: Eighty Six, Kaguya-sama',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/4713c58b-833f-4c92-bf4a-0e2f7af8a461_600x600_i?s=925a453653da58d385adb82b5d423a69'
  },
  {
    id: 'comp_06',
    name: 'Kyoto Animation',
    type: 'Estúdio de Animação & Arte',
    notableWorks: 'Violet Evergarden, A Silent Voice, Hyouka',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/b066ff17-81d3-40db-b1f2-2927de70c0e3_600x600_i?s=edb149cf051e2d7984975063a1b3b3a7'
  },
  {
    id: 'comp_07',
    name: 'WIT Studio',
    type: 'Estúdio de Animação',
    notableWorks: 'Vinland Saga S1, Spy x Family, Vivy',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/e7e64f9e-23f6-4c74-9813-cb4fcdb600cf_600x600_i?s=37f6a1b3342db61d87d4e50803fd6fd6'
  },
  {
    id: 'comp_08',
    name: 'Trigger',
    type: 'Estúdio de Animação Autoral',
    notableWorks: 'Cyberpunk: Edgerunners, Kill la Kill, Delicious in Dungeon',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/bc3f892a-8581-45b1-8a95-81b6ac518f3d_600x600_i?s=d2a2e7f05478dbb999b17d35c44445db'
  },
  {
    id: 'comp_09',
    name: 'Bones',
    type: 'Estúdio de Animação',
    notableWorks: 'Mob Psycho 100, Fullmetal Alchemist: Brotherhood',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/969047f0-a8ec-475e-ad0d-6e0d5cd8e17f_600x600_i?s=4145bdb95a29f3fe1447baa8045a7420'
  },
  {
    id: 'comp_10',
    name: 'Aniplex',
    type: 'Produtora & Distribuidora',
    notableWorks: 'Demon Slayer, Sword Art Online, Fate Series',
    logoUrl: 'https://cdn.myanimelist.net/s/common/company_logos/ba2241ea-7f83-45b6-9360-1f1d4de0d65a_600x600_i?s=369f1423117062ab3c7f4c7a90b2005a'
  }
];

export const FAVORITE_PEOPLE: FavoritePerson[] = [
  {
    id: 'person_01',
    name: 'Hiroyuki Sawano',
    role: 'Compositor & Produtor Musical',
    notableWork: 'Attack on Titan, Solo Leveling, Kill la Kill',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n103509-IzuF5bIsiQnH.jpg'
  },
  {
    id: 'person_02',
    name: 'Keiichirou Saitou',
    role: 'Diretor de Animação',
    notableWork: 'Sousou no Frieren, Bocchi the Rock!',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n134254-bqcsuWzJr87n.png'
  },
  {
    id: 'person_03',
    name: 'Makoto Shinkai',
    role: 'Diretor & Roteirista de Cinema',
    notableWork: 'Your Name, Weathering With You, Suzume',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n96117-X0ivK1cAvdzA.png'
  },
  {
    id: 'person_04',
    name: 'Kenjiro Tsuda',
    role: 'Dublador / Seiyuu',
    notableWork: 'Kento Nanami (JJK), Kishibe (Chainsaw Man)',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n95591-WQGdD3ubbeoq.jpg'
  },
  {
    id: 'person_05',
    name: 'Rie Takahashi',
    role: 'Dubladora / Seiyuu',
    notableWork: 'Megumin (KonoSuba), Ai Hoshino (Oshi no Ko)',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n119331-5dPuMCxu4RWf.jpg'
  },
  {
    id: 'person_06',
    name: 'Yuki Kaji',
    role: 'Dublador / Seiyuu',
    notableWork: 'Eren Yeager (AOT), Shoto Todoroki (MHA)',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n95672-T33YV7yCDKnL.png'
  },
  {
    id: 'person_07',
    name: 'Evan Call',
    role: 'Compositor Orquestral',
    notableWork: 'Sousou no Frieren, Violet Evergarden',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n119999-D6YFCpQPSoHf.png'
  },
  {
    id: 'person_08',
    name: 'Shingo Yamashita',
    role: 'Animador & Diretor de Aberturas',
    notableWork: 'Jujutsu Kaisen OP1, Chainsaw Man ED',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n114914-aZHfx54YFvVl.png'
  },
  {
    id: 'person_09',
    name: 'Aoi Yuuki',
    role: 'Dubladora / Seiyuu',
    notableWork: 'Tanya Degurechaff, Madoka Kaname, Maomao',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n101686-PTd0lQZMsmcv.png'
  },
  {
    id: 'person_10',
    name: 'Hiromu Arakawa',
    role: 'Mangaká Autora',
    notableWork: 'Fullmetal Alchemist, Silver Spoon',
    imageUrl: 'https://s4.anilist.co/file/anilistcdn/staff/large/n96874-afKcZQmOlrJL.png'
  }
];
