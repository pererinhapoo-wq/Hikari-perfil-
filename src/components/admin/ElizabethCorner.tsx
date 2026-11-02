import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Pause, 
  Play, 
  Sparkles,
  VolumeX
} from 'lucide-react';
import { AUTHORIZED_ADMIN_UID } from '../../types';
import { isProfileAdmin } from './ElizabethAdminBadge';

export interface ElizabethCornerProps {
  /**
   * UID do perfil ativo. Só renderiza se for estritamente a conta administradora da Elizabeth.
   */
  profileUid: string;
}

export const ELIZABETH_SIGNBOARD_PHRASES: string[] = [
  'Passou 40 minutos escolhendo o que assistir... e acabou revendo o mesmo episódio pela quarta vez.',
  'Sua lista de "Planejados" tem 184 animes. A expectativa de vida humana não suporta tudo isso.',
  'Diz que não tem tempo para estudar, mas maratona 24 episódios numa terça-feira à noite.',
  'Fez textão de 500 palavras sobre consistência de roteiro, mas chora quando o protagonista sorri.',
  'Comprando mangá que já leu na internet só para deixar na estante pegando poeira estética.',
  'Pulou a abertura pela primeira vez e sentiu uma pontada de culpa moral imediata.',
  'Prometeu ir dormir às 23h. Às 04h15: "Só mais um episódio para ver quem é o traidor."',
  'Classificou o anime como 10/10 na empolgação e agora tem vergonha de admitir pros amigos.',
  'Colocou o anime em 1.5x de velocidade e finge que captou toda a profundidade filosófica.',
  'Reclamando de episódio filler exibido em 2012 em pleno ano de 2026.',
  'Discutiu 2 horas num fórum sobre quem venceria uma luta que nunca vai acontecer.',
  'Se eu soltar essa placa, o Kotarou descobre que estou comendo o yakisoba dele escondida.',
];

export const ElizabethCorner: React.FC<ElizabethCornerProps> = ({ profileUid }) => {
  // Limite estrito de presença: Elizabeth aparece somente no perfil público da administração
  if (!isProfileAdmin(profileUid)) {
    return null;
  }

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [tiltDirection, setTiltDirection] = useState<'left' | 'right'>('right');

  const timerRef = useRef<number | null>(null);

  const currentPhrase = ELIZABETH_SIGNBOARD_PHRASES[currentIndex] || ELIZABETH_SIGNBOARD_PHRASES[0];

  const changePhrase = useCallback((direction: 'next' | 'prev') => {
    setIsTransitioning(true);
    setTiltDirection(direction === 'next' ? 'right' : 'left');

    const timeout = window.setTimeout(() => {
      setCurrentIndex((prev) => {
        if (direction === 'next') {
          return (prev + 1) % ELIZABETH_SIGNBOARD_PHRASES.length;
        }
        return (prev - 1 + ELIZABETH_SIGNBOARD_PHRASES.length) % ELIZABETH_SIGNBOARD_PHRASES.length;
      });
      setIsTransitioning(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, []);

  const handleNext = useCallback(() => {
    changePhrase('next');
  }, [changePhrase]);

  const handlePrev = useCallback(() => {
    changePhrase('prev');
  }, [changePhrase]);

  // Rotação automática suave a cada 7 segundos quando ativa e sem hover
  useEffect(() => {
    if (!isPlaying || isHovered) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = window.setInterval(() => {
      handleNext();
    }, 7000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, isHovered, handleNext]);

  // Cálculo de tipografia proporcional e segura para evitar qualquer quebra ou corte
  const getTypographyClass = (text: string) => {
    const len = text.length;
    if (len <= 65) {
      return 'text-sm sm:text-base font-bold leading-snug';
    }
    if (len <= 85) {
      return 'text-xs sm:text-sm font-semibold leading-relaxed';
    }
    return 'text-[11px] sm:text-xs font-semibold leading-relaxed';
  };

  return (
    <section 
      aria-label="Elizabeth's Corner — Mensagens Oficiais da Administração"
      className="relative w-full overflow-hidden rounded-2xl border border-purple-800/40 bg-gradient-to-br from-[#150F28] via-[#100B20] to-[#170E2B] p-4 sm:p-5 shadow-xl shadow-purple-950/50 mb-6 transition-all"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Decoração sutil de fundo Hikari */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-purple-600/10 blur-3xl"
      />
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-indigo-600/10 blur-3xl"
      />

      {/* Cabeçalho do Corner */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-purple-900/30 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Elizabeth&apos;s Corner
              </h2>
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border border-purple-700/40 bg-purple-950/60 text-purple-300">
                <VolumeX className="h-2.5 w-2.5" />
                Comunicação por Placas
              </span>
            </div>
            <p className="text-[11px] text-purple-300/70">
              Observações irrefutáveis da administração sobre a sua rotina de animes.
            </p>
          </div>
        </div>

        {/* Controles de Navegação da Placa */}
        <div className="flex items-center gap-1.5 bg-[#0D081B] border border-purple-900/40 rounded-xl px-2 py-1 shadow-inner">
          <span className="text-[11px] font-medium text-purple-300/70 tabular-nums px-1.5">
            {currentIndex + 1} / {ELIZABETH_SIGNBOARD_PHRASES.length}
          </span>

          <button
            type="button"
            onClick={handlePrev}
            className="p-1 rounded-lg text-purple-300 hover:text-white hover:bg-purple-900/50 transition-colors active:scale-95 cursor-pointer"
            title="Frase anterior"
            aria-label="Frase anterior da Elizabeth"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsPlaying((prev) => !prev)}
            className="p-1 rounded-lg text-purple-300 hover:text-white hover:bg-purple-900/50 transition-colors active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pausar troca automática' : 'Retomar troca automática'}
            aria-label={isPlaying ? 'Pausar placas' : 'Iniciar rotação das placas'}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 text-amber-300" />
            )}
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="p-1 rounded-lg text-purple-300 hover:text-white hover:bg-purple-900/50 transition-colors active:scale-95 cursor-pointer"
            title="Próxima frase"
            aria-label="Próxima frase da Elizabeth"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Conteúdo Principal: Elizabeth + Placa Retangular Interativa */}
      <div className="relative flex flex-col md:flex-row items-center justify-center gap-4 sm:gap-6 py-1">
        
        {/* Personagem Elizabeth com sua fita oficial */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div className="relative group">
            <div className="h-28 w-28 sm:h-32 sm:w-32 rounded-2xl overflow-hidden border-2 border-amber-600/40 bg-[#160E26] shadow-lg shadow-black/80 ring-2 ring-purple-600/30 transition-transform duration-300 group-hover:scale-105">
              <img
                src="/src/assets/images/elizabeth_signboard_art_1793603552414.jpg"
                alt="Elizabeth segurando placa de madeira"
                className="h-full w-full object-cover object-top"
                loading="lazy"
                decoding="async"
              />
            </div>
            {/* Tag cômica inferior */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-purple-950/90 border border-purple-500/50 px-2 py-0.5 text-[10px] font-bold text-purple-200 shadow-md">
              Elizabeth ✦
            </div>
          </div>
        </div>

        {/* Placa Retangular Animada da Elizabeth */}
        <div className="w-full max-w-xl flex-1 flex flex-col items-center md:items-start">
          <div 
            className={`relative w-full transition-all duration-300 ease-out motion-reduce:transform-none ${
              isTransitioning
                ? tiltDirection === 'right'
                  ? 'rotate-1 opacity-70 scale-[0.98]'
                  : '-rotate-1 opacity-70 scale-[0.98]'
                : 'rotate-0 opacity-100 scale-100'
            }`}
          >
            {/* O corpo da placa de madeira com cantos reforçados e cabo visual */}
            <div className="relative w-full rounded-xl border-2 sm:border-3 border-amber-800/80 bg-gradient-to-b from-[#20152F] to-[#170E24] p-4 sm:p-5 shadow-2xl shadow-black/80 ring-1 ring-amber-500/30">
              
              {/* Moldura de madeira interna clássica da placa de caligrafia */}
              <div className="relative min-h-[92px] sm:min-h-[104px] flex items-center justify-center rounded-lg border border-amber-900/60 bg-[#120B1D]/90 px-4 py-3 sm:px-6 sm:py-4 shadow-inner text-center">
                
                {/* Efeito sutil de grão de madeira / papel pergaminho */}
                <div 
                  aria-hidden="true" 
                  className="pointer-events-none absolute inset-0 rounded-lg opacity-10 bg-[radial-gradient(#FDE68A_1px,transparent_1px)] [background-size:12px_12px]" 
                />

                {/* Texto da frase com ajuste dinâmico de tamanho */}
                <p 
                  className={`relative text-amber-100 select-none max-w-lg break-words hyphens-auto transition-opacity duration-200 ${getTypographyClass(currentPhrase)}`}
                >
                  &ldquo;{currentPhrase}&rdquo;
                </p>
              </div>

              {/* Cabo de madeira da placa na parte inferior central */}
              <div 
                aria-hidden="true" 
                className="absolute -bottom-3 left-1/2 -translate-x-1/2 h-3 w-4 rounded-b-md border-x border-b border-amber-900/90 bg-amber-950/80 shadow-md"
              />
            </div>
          </div>

          {/* Dica discreta de leitura */}
          <div className="mt-3 flex items-center justify-between w-full text-[10px] text-purple-400/60 px-1">
            <span>Passe o mouse ou toque para pausar a leitura.</span>
            <span className="hidden sm:inline font-mono">Gintama Inspiration · Geração #02</span>
          </div>
        </div>

      </div>
    </section>
  );
};
