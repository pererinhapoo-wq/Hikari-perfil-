import React from 'react';
import { 
  Tv, 
  Sparkles, 
  Building2, 
  Users, 
  Heart,
  Film
} from 'lucide-react';
import { AnimeItem, FavoriteCharacter, FavoriteCompany, FavoritePerson } from '../../types';
import { FAVORITE_CHARACTERS, FAVORITE_COMPANIES, FAVORITE_PEOPLE } from '../../data/mockData';

interface FavoritesTabProps {
  favorites: AnimeItem[];
  characters?: FavoriteCharacter[];
  companies?: FavoriteCompany[];
  people?: FavoritePerson[];
  isOwnProfile: boolean;
  onToggleFavorite: (id: string) => void;
  onNavigateToAnimes: () => void;
}

export const FavoritesTab: React.FC<FavoritesTabProps> = ({
  favorites,
  characters = FAVORITE_CHARACTERS,
  companies = FAVORITE_COMPANIES,
  people = FAVORITE_PEOPLE,
  isOwnProfile,
  onToggleFavorite,
  onNavigateToAnimes
}) => {
  // Sliced to maximum 10 items strictly as demanded by specification
  const animeFavorites = favorites.slice(0, 10);
  const characterFavorites = characters.slice(0, 10);
  const companyFavorites = companies.slice(0, 10);
  const personFavorites = people.slice(0, 10);

  return (
    <div className="space-y-8 pb-8">
      {/* SECTION 1: Favoritos - Anime (Max 10, Compact 3-Column Mobile Grid, Proportional Covers, NO 'Ver todos') */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-2.5">
          <div className="flex items-center gap-2">
            <Tv className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">Favoritos — Animes</h2>
          </div>
        </div>

        {animeFavorites.length === 0 ? (
          <div className="rounded-2xl border border-purple-900/30 bg-[#130E24]/60 p-8 text-center">
            <Tv className="mx-auto h-8 w-8 text-purple-400/40" />
            <h3 className="mt-2 text-sm font-bold text-white">Nenhum anime favoritado</h3>
            <p className="mt-1 text-xs text-purple-300/60 max-w-sm mx-auto">
              {isOwnProfile
                ? 'Adicione animes aos seus favoritos para destacá-los aqui no topo do seu perfil.'
                : 'Este usuário ainda não destacou animes favoritos.'}
            </p>
            {isOwnProfile && (
              <button
                type="button"
                onClick={onNavigateToAnimes}
                className="mt-3 rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 transition-colors cursor-pointer"
              >
                Ir para Lista de Animes
              </button>
            )}
          </div>
        ) : (
          /* Mobile: strictly 3 cards per row; Tablet: 4-5 cards */
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 sm:gap-3">
            {animeFavorites.map((anime) => (
              <div
                key={anime.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-purple-900/40 bg-[#130E24] p-1.5 sm:p-2 shadow-md transition-all hover:border-purple-500/50 hover:bg-[#18112e]"
              >
                <div 
                  onClick={onNavigateToAnimes}
                  className="cursor-pointer"
                  title={`Ver ${anime.title} na lista de animes`}
                >
                  <div className="relative aspect-3/4 w-full overflow-hidden rounded-lg bg-purple-950/40">
                    <img
                      src={anime.posterUrl}
                      alt={anime.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {/* Rating badge - clean score without star glyph */}
                    <div className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 rounded bg-black/75 px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold text-amber-300 backdrop-blur-md border border-amber-500/20">
                      {anime.rating}
                    </div>

                    {/* Episodes & Year pill */}
                    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between text-[8px] sm:text-[9px] text-purple-200/90 font-mono bg-black/60 px-1 py-0.5 rounded backdrop-blur-xs">
                      <span>{anime.year}</span>
                      <span>{anime.totalEpisodes} ep</span>
                    </div>
                  </div>

                  <div className="mt-1.5 px-0.5">
                    <h3 
                      className="text-[11px] sm:text-xs font-semibold text-white line-clamp-1 group-hover:text-purple-300 transition-colors"
                      title={anime.title}
                    >
                      {anime.title}
                    </h3>
                    <p className="text-[9px] sm:text-[10px] text-purple-300/50 truncate mt-0.5">
                      {anime.genres.slice(0, 2).join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2: Favoritos - Personagens (Horizontal Scroll, Max 10, NO 'Ver todos') */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">Favoritos — Personagens</h2>
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 overscroll-x-contain no-scrollbar">
          {characterFavorites.map((char) => (
            <div
              key={char.id}
              className="group flex-shrink-0 w-32 sm:w-36 rounded-xl border border-purple-900/40 bg-[#130E24] p-2 transition-all hover:border-purple-500/50 hover:bg-[#18112e]"
            >
              <div className="relative aspect-4/5 w-full overflow-hidden rounded-lg bg-purple-950/40">
                <img
                  src={char.imageUrl}
                  alt={char.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>

              <div className="mt-2 px-0.5">
                <h4 className="text-xs font-bold text-white truncate group-hover:text-purple-300 transition-colors">
                  {char.name}
                </h4>
                {char.originalName && (
                  <span className="text-[10px] text-purple-400/60 block truncate">
                    {char.originalName}
                  </span>
                )}
                <span className="text-[10px] text-purple-300/70 block truncate mt-0.5 font-medium">
                  {char.animeName}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: Favoritos - Empresas & Estúdios (Horizontal Scroll, Max 10, NO 'Ver todos') */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-2.5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">Favoritos — Empresas & Estúdios</h2>
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 overscroll-x-contain no-scrollbar">
          {companyFavorites.map((company) => (
            <div
              key={company.id}
              className="group flex-shrink-0 w-48 sm:w-56 rounded-xl border border-purple-900/40 bg-[#130E24] p-3 transition-all hover:border-purple-500/50 hover:bg-[#18112e]"
            >
              <div className="flex items-center gap-3">
                <img
                  src={company.logoUrl}
                  alt={company.name}
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-lg object-cover border border-purple-900/40 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-purple-300 transition-colors">
                    {company.name}
                  </h4>
                  <span className="text-[10px] text-purple-400/70 block truncate">
                    {company.type}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 border-t border-purple-900/30 pt-2">
                <span className="text-[9px] text-purple-400/60 uppercase font-semibold block">
                  Obras notáveis
                </span>
                <p className="text-[11px] text-purple-200/90 truncate mt-0.5" title={company.notableWorks}>
                  {company.notableWorks}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 4: Favoritos - Pessoas (Horizontal Scroll, Max 10, NO 'Ver todos') */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-purple-900/30 pb-2.5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">Favoritos — Pessoas (Criadores & Voz)</h2>
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 overscroll-x-contain no-scrollbar">
          {personFavorites.map((person) => (
            <div
              key={person.id}
              className="group flex-shrink-0 w-36 sm:w-40 rounded-xl border border-purple-900/40 bg-[#130E24] p-2.5 transition-all hover:border-purple-500/50 hover:bg-[#18112e]"
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-purple-950/40">
                <img
                  src={person.imageUrl}
                  alt={person.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>

              <div className="mt-2 px-0.5">
                <h4 className="text-xs font-bold text-white truncate group-hover:text-purple-300 transition-colors">
                  {person.name}
                </h4>
                <span className="inline-block mt-0.5 rounded bg-purple-950/80 border border-purple-800/40 px-1.5 py-0.2 text-[9px] font-medium text-purple-300 truncate max-w-full">
                  {person.role}
                </span>
                <span className="text-[10px] text-purple-300/60 block truncate mt-1" title={person.notableWork}>
                  {person.notableWork}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
