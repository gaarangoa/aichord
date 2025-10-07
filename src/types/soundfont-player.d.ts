declare module 'soundfont-player' {
  export interface PlayerOptions {
    format?: 'mp3' | 'ogg';
    soundfont?: 'MusyngKite' | 'FluidR3_GM';
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    adsr?: number[];
    duration?: number;
  }

  export interface Player {
    play: (notes: string | string[], when?: number, options?: { duration?: number }) => void;
    stop: (when?: number) => void;
  }

  export type InstrumentName = 'acoustic_grand_piano' | string;

  export function instrument(
    ac: AudioContext,
    name: InstrumentName,
    options?: PlayerOptions
  ): Promise<Player>;

  const Soundfont: {
    instrument: typeof instrument;
  };

  export default Soundfont;
}