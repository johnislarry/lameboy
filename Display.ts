import { Clock } from './Clock';
import { Memory, Color, LY, LYC, LCDC, STAT, SCX, SCY } from './Memory';

type ModeToBits = {
  hBlank: 0,
  vBlank: 1,
  searching: 2,
  transferring: 3,
};
type Mode = keyof ModeToBits;

const SCREEN_X = 160;
const SCREEN_Y = 144;
const SEARCHING_TIME = 80;
const HBLANK_TIME = 204;
const VBLANK_TIME = 4560;
const TRANSFERING_TIME = 172;
const MODE_TO_BITS: ModeToBits = {
  hBlank: 0,
  vBlank: 1,
  searching: 2,
  transferring: 3,
};
const STAT_COINCIDENCE_ENABLE_MASK = 0x40;
const STAT_OAM_INTERRUPT_ENABLE_MASK = 0x20;
const STAT_VBLANK_INTERRUPT_ENABLE_MASK = 0x10;
const STAT_HBLANK_INTERRUPT_ENABLE_MASK = 0x8;
const STAT_COINCIDENCE_FLAG_MASK = 0x4;
const DISPLAY_ENABLE_MASK = 0x80;

export class Display {
  _clock: Clock;
  _memory: Memory;
  _canvasContext: CanvasRenderingContext2D;
  _fullBuffer: Uint8Array;
  _visibleBuffer: Uint8ClampedArray;
  _mode: Mode;
  _displayEnabled: boolean;

  constructor(clock: Clock, memory: Memory) {
    this._clock = clock;
    this._memory = memory;
    this._fullBuffer = new Uint8Array(0x100 * 0x100 * 4);
    this._visibleBuffer = new Uint8ClampedArray(SCREEN_X * SCREEN_Y);
    this._canvasContext = this._createCanvas();
    this._displayEnabled = true;
    // We watch writes to this LCDC register to know when to re-schedule jobs
    // when the bit has been set again.
    this._memory.watch(LCDC, this._onLcdcWrite.bind(this));
    this._handleMode('searching');
  }

  _handleMode(mode: Mode): void {
    const displayEnable = Boolean(this._memory.read(LCDC) & DISPLAY_ENABLE_MASK);
    if (!displayEnable) {
      // If the display has been turned off then we will just exit here and no more display jobs
      // will be scheuled.
      this._displayEnabled = false;
      return;
    }
    switch (mode) {
      case 'searching': {
        this._memory.write(LY, 0);
        this._clock.schedule(SEARCHING_TIME, () => this._handleMode('transferring'));
        break;
      }
      case 'transferring': {
        this._readLine();
        this._clock.schedule(TRANSFERING_TIME, () => this._handleMode('hBlank'));
        break;
      }
      case 'hBlank': {
        // NOTE: valid values for LY also include 145-153, but these are never attained in this
        // implementation.
        const ly = this._memory.read(LY);
        this._memory.write(LY, ly + 1);
        this._clock.schedule(
          HBLANK_TIME,
          () => this._handleMode(ly + 1 === SCREEN_Y ? 'vBlank' : 'searching'),
        );
        break;
      }
      case 'vBlank': {
        this._draw();
        this._memory.requestInterrupt('vBlank');
        this._clock.schedule(VBLANK_TIME, () => this._handleMode('searching'));
        break;
      }
      default: throw new Error(`unrecognized mode: ${mode}`);
    }
    this._setStatFlags(mode);
    this._requestInterrupt(mode);
  }

  _readLine(): void {
    // Draw the background
    // TODO window and sprites
    const bgTileMapSelect = Boolean(this._memory.read(LCDC) & 0x8);
    if (bgTileMapSelect) {
      // Tile map at: 9C00-9FFF.
      this._tileMap(
        addr => this._memory.readVram0(0x9C00 + addr),
        addr => this._memory.readVram1(0x9C00 + addr),
      );
    } else {
      // Tile map at: 9800-9BFF.
      this._tileMap(
        addr => this._memory.readVram0(0x9800 + addr),
        addr => this._memory.readVram1(0x9800 + addr),
      );
    }
  }

  _tileMap(
    readTileMap0: (addr: number) => number,
    readTileMap1: (addr: number) => number,
  ): void {
    const tileDataSelect = Boolean(this._memory.read(LCDC) & 0x10);
    if (tileDataSelect) {
      // Tile data: 8000-8FFF, unsigned.
      // TODO only load the needed line, not the whole buffer.
      for (let tileIndex = 0; tileIndex < 0x400; tileIndex++) {
        const tileOffset = readTileMap0(0x9C00 + tileIndex);
        const otherData = readTileMap1(0x9C00 + tileIndex);
        // TODO respect the rest of the `otherData`.
        const paletteIndex = otherData & 0x7;
        const colors = this._memory.getBgPaletteColors(paletteIndex);
        const isTileVram1 = Boolean(otherData & 0x8);
        if (isTileVram1) {
          this._putTileData(
            addr => this._memory.readVram1(0x8000 + tileOffset + addr),
            tileIndex,
            colors,
          );
        } else {
          this._putTileData(
            addr => this._memory.readVram0(0x8000 + tileOffset + addr),
            tileIndex,
            colors,
          );
        }

      }
    } else {
      // Tile data: 8800-97FF, signed.
    }
  }

  _putTileData(
    readVram: (addr: number) => number,
    tileIndex: number,
    colors: Color[],
  ): void {
    for (let j = 0; j < 16; j += 2) {
      const byte0 = readVram(j);
      const byte1 = readVram(j + 1);
      for (let k = 0; k < 8; k++) {
        let hi = byte1 & 0x1;
        let lo = byte0 & 0x1;
        const colorIndex = (hi << 1) | lo;
        const color = colors[colorIndex];
        const scX = this._memory.read(SCX);
        const scY = this._memory.read(SCY);
        // TODO ugh
        const unscrolledBufferIndex =
          ((Math.floor(tileIndex / 0x20) * 0x20) + (tileIndex % 0x20) + Math.floor(j / 2) * k);
        const bufferY = (Math.floor(unscrolledBufferIndex / 0x100) + scY) % 0x100;
        const bufferX = (unscrolledBufferIndex % 0x100 + scX) % 0x100;
        const bufferIndex = 4 * (bufferY * 0x100 + bufferX);
        this._fullBuffer[bufferIndex] = color.red;
        this._fullBuffer[bufferIndex + 1] = color.green;
        this._fullBuffer[bufferIndex + 2] = color.blue;
        this._fullBuffer[bufferIndex + 3] = 0xFF;
        lo = lo >> 1;
        hi = hi >> 1;
      }
    }
  }

  _onLcdcWrite(val: number): void {
    const displayEnable = Boolean(val & DISPLAY_ENABLE_MASK);
    if (displayEnable && !this._displayEnabled) {
      this._displayEnabled = true;
      this._handleMode('searching');
    }
  }

  _requestInterrupt(mode: Mode): void {
    const stat = this._memory.read(STAT);
    const coincidenceEnable = Boolean(stat & STAT_COINCIDENCE_ENABLE_MASK);
    const coincidenceFlag = Boolean(stat & STAT_COINCIDENCE_FLAG_MASK);
    const oamEnabled = Boolean(stat & STAT_OAM_INTERRUPT_ENABLE_MASK);
    const vBlankEnabled = Boolean(stat & STAT_VBLANK_INTERRUPT_ENABLE_MASK);
    const hBlankEnabled = Boolean(stat & STAT_HBLANK_INTERRUPT_ENABLE_MASK);
    if (
      coincidenceFlag && coincidenceEnable
      || mode === 'vBlank' && vBlankEnabled
      || mode === 'hBlank' && hBlankEnabled
      || mode === 'searching' && oamEnabled
    ) {
      this._memory.requestInterrupt('lcdStat');
    }
  }

  _setStatFlags(mode: Mode): void {
    const stat = this._memory.read(STAT);
    const newStat = stat & (~0x7);
    const coincidence = this._memory.read(LY) === this._memory.read(LYC)
      ? STAT_COINCIDENCE_FLAG_MASK
      : 0x0;
    const flags = coincidence + MODE_TO_BITS[mode];
    this._memory.write(STAT, newStat | flags);
  }

  _createCanvas(): CanvasRenderingContext2D {
    const body = document.querySelector('body') as HTMLElement;
    const screen = document.createElement('canvas');
    screen.width = SCREEN_X;
    screen.height = SCREEN_Y;
    body.appendChild(screen);
    return screen.getContext('2d') as CanvasRenderingContext2D;
  }

  _draw(): void {
    const imageData = new ImageData(this._visibleBuffer, SCREEN_X, SCREEN_Y);
    this._canvasContext.putImageData(imageData, 0, 0);
  }
}