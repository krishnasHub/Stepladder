/**
 * Four colours per level: background, environment, player, hazard.
 * Re-tinting per level is what makes levels feel distinct for near-zero work.
 */
export interface Palette {
  name: string;
  bg: number;
  bgAccent: number; // faint parallax shapes behind the terrain
  env: number; // terrain
  player: number;
  hazard: number; // bots, projectiles, spikes
  ink: number; // HUD text
}

export const PALETTES: Palette[] = [
  {
    name: 'Mint',
    bg: 0xe4f2e7,
    bgAccent: 0xd2e7d8,
    env: 0x86b8a1,
    player: 0xef7d8e,
    hazard: 0xe0a458,
    ink: 0x3f5361,
  },
  {
    name: 'Lavender',
    bg: 0xece6f5,
    bgAccent: 0xdcd3ea,
    env: 0x9d8bb0,
    player: 0x6fc9b8,
    hazard: 0xe8748b,
    ink: 0x453a52,
  },
  {
    name: 'Peach',
    bg: 0xfbeadd,
    bgAccent: 0xf3dcc9,
    env: 0xd69f7e,
    player: 0x5b93c9,
    hazard: 0xc1666b,
    ink: 0x5b4238,
  },
  {
    name: 'Sky',
    bg: 0xe3eefb,
    bgAccent: 0xd1e2f4,
    env: 0x7f9db9,
    player: 0xf2b134,
    hazard: 0xd1495b,
    ink: 0x35445c,
  },
  {
    name: 'Rose',
    bg: 0xfae6ea,
    bgAccent: 0xf0d5dc,
    env: 0xc08497,
    player: 0x5fa8a0,
    hazard: 0xe05263,
    ink: 0x4a3540,
  },
  {
    name: 'Slate',
    bg: 0xe8eaed,
    bgAccent: 0xd8dce1,
    env: 0x8c95a3,
    player: 0xe8a0bf,
    hazard: 0xd96c5f,
    ink: 0x394150,
  },
];

export function paletteFor(levelIndex: number): Palette {
  return PALETTES[levelIndex % PALETTES.length];
}

export function cssHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
